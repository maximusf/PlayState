import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Stand-in for Clerk: the "session" is whatever user ID the test header carries.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: (req: Request) => ({ userId: req.headers["x-test-user"] ?? null }),
}));
vi.mock("@clerk/express/webhooks", () => ({ verifyWebhook: vi.fn() }));

const db = vi.hoisted(() => ({
  userGame: { findMany: vi.fn() },
  party: { findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  partyMember: { updateMany: vi.fn() },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { AVATAR_HAT_IDS, PARTY_BACKDROP_IDS } from "../src/lib/party-cosmetics";

const CODE = "abcDEF123_-x";
const member = (userId: string, displayName: string, hatId: string | null = null) => ({
  id: `member_${displayName.toLowerCase()}`,
  partyId: "party_1",
  userId,
  displayName,
  hatId,
});
const party = (...members: ReturnType<typeof member>[]) => ({
  id: "party_1",
  code: CODE,
  name: "Friday night",
  // user_a started the party.
  hostId: "user_a",
  removedUserIds: [] as string[],
  rolledIgdbId: null,
  rolledAt: null,
  ignoreLimits: false,
  backdropId: null as string | null,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  extended: false,
  createdAt: new Date(),
  members,
  nominations: [] as { userId: string; igdbId: number }[],
});

// Pulls the ids out of one list in the web app's cosmetics file, read as text so the test
// needs no browser code.
function webIds(list: string): string[] {
  const source = readFileSync(
    resolve(__dirname, "../../web/src/lib/party-cosmetics.ts"),
    "utf8",
  );
  const block = source.match(new RegExp(`export const ${list} = \\[([\\s\\S]*?)\\] as const`));
  if (!block) throw new Error(`${list} not found in the web cosmetics file.`);

  return [...block[1].matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.party.deleteMany.mockResolvedValue({ count: 0 });
  db.userGame.findMany.mockResolvedValue([]);
});

describe("party cosmetics", () => {
  it("keeps the server's hat and backdrop lists in step with the web manifest", () => {
    expect([...AVATAR_HAT_IDS]).toEqual(webIds("AVATAR_HATS"));
    expect([...PARTY_BACKDROP_IDS]).toEqual(webIds("PARTY_BACKDROPS"));
  });

  it("requires sign-in", async () => {
    const hat = await request(app).patch(`/api/parties/${CODE}/me`).send({ hatId: "crown" });
    const backdrop = await request(app)
      .patch(`/api/parties/${CODE}/backdrop`)
      .send({ backdropId: "space" });

    expect(hat.status).toBe(401);
    expect(backdrop.status).toBe(401);
  });

  it("lets a member set and clear only their own hat", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const set = await request(app)
      .patch(`/api/parties/${CODE}/me`)
      .set("x-test-user", "user_b")
      .send({ hatId: "wizard-hat" });
    const clear = await request(app)
      .patch(`/api/parties/${CODE}/me`)
      .set("x-test-user", "user_b")
      .send({ hatId: null });

    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ hatId: "wizard-hat" });
    expect(clear.body.data).toMatchObject({ hatId: null });
    // Always the caller's own row, found from the signed-in user and never from the request.
    expect(db.partyMember.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "member_sam", partyId: "party_1" },
      data: { hatId: "wizard-hat" },
    });
    expect(db.partyMember.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "member_sam", partyId: "party_1" },
      data: { hatId: null },
    });
  });

  it("ignores a member id sent in the body, so nobody can dress someone else", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    await request(app)
      .patch(`/api/parties/${CODE}/me`)
      .set("x-test-user", "user_b")
      .send({ hatId: "crown", memberId: "member_max" });

    expect(db.partyMember.updateMany).toHaveBeenCalledWith({
      where: { id: "member_sam", partyId: "party_1" },
      data: { hatId: "crown" },
    });
  });

  it("rejects a hat id that is not in the list, or a missing one", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max")));

    for (const body of [{ hatId: "tinfoil" }, { hatId: 3 }, { hatId: "" }, {}]) {
      const res = await request(app)
        .patch(`/api/parties/${CODE}/me`)
        .set("x-test-user", "user_a")
        .send(body);

      expect(res.status).toBe(400);
    }

    expect(db.partyMember.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a removed player and a stranger from changing a hat", async () => {
    db.party.findUnique.mockResolvedValue({
      ...party(member("user_a", "Max")),
      removedUserIds: ["user_b"],
    });

    const removed = await request(app)
      .patch(`/api/parties/${CODE}/me`)
      .set("x-test-user", "user_b")
      .send({ hatId: "crown" });
    const stranger = await request(app)
      .patch(`/api/parties/${CODE}/me`)
      .set("x-test-user", "user_z")
      .send({ hatId: "crown" });

    expect(removed.status).toBe(403);
    expect(stranger.status).toBe(403);
    expect(db.partyMember.updateMany).not.toHaveBeenCalled();
  });

  it("lets only the host set the backdrop", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const byHost = await request(app)
      .patch(`/api/parties/${CODE}/backdrop`)
      .set("x-test-user", "user_a")
      .send({ backdropId: "space" });
    const cleared = await request(app)
      .patch(`/api/parties/${CODE}/backdrop`)
      .set("x-test-user", "user_a")
      .send({ backdropId: null });
    const byMember = await request(app)
      .patch(`/api/parties/${CODE}/backdrop`)
      .set("x-test-user", "user_b")
      .send({ backdropId: "arcade" });

    expect(byHost.status).toBe(200);
    expect(byHost.body.data).toMatchObject({ backdropId: "space" });
    expect(cleared.body.data).toMatchObject({ backdropId: null });
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("PARTY_NOT_HOST");
    expect(db.party.update).toHaveBeenCalledTimes(2);
    expect(db.party.update).toHaveBeenNthCalledWith(1, {
      where: { id: "party_1" },
      data: { backdropId: "space" },
    });
  });

  it("rejects a backdrop id that is not in the list", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max")));

    for (const body of [{ backdropId: "volcano" }, { backdropId: 1 }, {}]) {
      const res = await request(app)
        .patch(`/api/parties/${CODE}/backdrop`)
        .set("x-test-user", "user_a")
        .send(body);

      expect(res.status).toBe(400);
    }

    expect(db.party.update).not.toHaveBeenCalled();
  });

  it("includes hats and the backdrop in the party, and in its version", async () => {
    const plain = party(member("user_a", "Max"), member("user_b", "Sam"));
    db.party.findUnique.mockResolvedValue(plain);
    const before = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_b");

    db.party.findUnique.mockResolvedValue({
      ...party(member("user_a", "Max", "crown"), member("user_b", "Sam")),
      backdropId: "city-night",
    });
    const after = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_b");

    expect(before.body.data.backdropId).toBeNull();
    expect(before.body.data.members.map((m: { hatId: unknown }) => m.hatId)).toEqual([null, null]);
    expect(after.body.data.backdropId).toBe("city-night");
    expect(after.body.data.members.map((m: { hatId: unknown }) => m.hatId)).toEqual(["crown", null]);
    expect(after.body.data.version).not.toBe(before.body.data.version);

    // A hat alone moves the version, and so does a backdrop alone.
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max", "crown"), member("user_b", "Sam")));
    const hatOnly = await request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", "user_b");
    db.party.findUnique.mockResolvedValue({ ...plain, backdropId: "arcade" });
    const backdropOnly = await request(app)
      .get(`/api/parties/${CODE}/version`)
      .set("x-test-user", "user_b");

    expect(hatOnly.body.data.version).not.toBe(before.body.data.version);
    expect(backdropOnly.body.data.version).not.toBe(before.body.data.version);
    expect(backdropOnly.body.data.version).not.toBe(hatOnly.body.data.version);
  });
});
