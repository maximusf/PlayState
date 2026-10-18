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
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { ROLL_STYLE_IDS } from "../src/lib/party-roll-styles";

const CODE = "abcDEF123_-x";
const member = (userId: string, displayName: string) => ({
  id: `member_${displayName.toLowerCase()}`,
  partyId: "party_1",
  userId,
  displayName,
  hatId: null as string | null,
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
  rollStyle: "classic",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  extended: false,
  createdAt: new Date(),
  members,
  nominations: [] as { userId: string; igdbId: number }[],
});

// Pulls the ids out of the list in the web app's roll styles file, read as text so the test
// needs no browser code.
function webIds(): string[] {
  const source = readFileSync(resolve(__dirname, "../../web/src/lib/party-roll-styles.ts"), "utf8");
  const block = source.match(/export const ROLL_STYLES = \[([\s\S]*?)\] as const/);
  if (!block) throw new Error("ROLL_STYLES not found in the web roll styles file.");

  return [...block[1].matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.party.deleteMany.mockResolvedValue({ count: 0 });
  db.userGame.findMany.mockResolvedValue([]);
});

describe("party roll style", () => {
  it("keeps the server's list in step with the web list", () => {
    expect([...ROLL_STYLE_IDS]).toEqual(webIds());
  });

  it("requires sign-in", async () => {
    const res = await request(app).patch(`/api/parties/${CODE}/roll-style`).send({ rollStyle: "carousel" });

    expect(res.status).toBe(401);
  });

  it("lets only the host choose the style", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const byHost = await request(app)
      .patch(`/api/parties/${CODE}/roll-style`)
      .set("x-test-user", "user_a")
      .send({ rollStyle: "triple-slot" });
    const byMember = await request(app)
      .patch(`/api/parties/${CODE}/roll-style`)
      .set("x-test-user", "user_b")
      .send({ rollStyle: "card-shuffle" });

    expect(byHost.status).toBe(200);
    expect(byHost.body.data).toMatchObject({ rollStyle: "triple-slot" });
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("PARTY_NOT_HOST");
    expect(db.party.update).toHaveBeenCalledTimes(1);
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { rollStyle: "triple-slot" },
    });
  });

  it("rejects a style that is not in the list, or a missing one", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max")));

    for (const body of [{ rollStyle: "roulette" }, { rollStyle: 3 }, { rollStyle: null }, {}]) {
      const res = await request(app)
        .patch(`/api/parties/${CODE}/roll-style`)
        .set("x-test-user", "user_a")
        .send(body);

      expect(res.status).toBe(400);
    }

    expect(db.party.update).not.toHaveBeenCalled();
  });

  it("blocks a removed player and a stranger", async () => {
    db.party.findUnique.mockResolvedValue({
      ...party(member("user_a", "Max")),
      removedUserIds: ["user_b"],
    });

    for (const user of ["user_b", "user_z"]) {
      const res = await request(app)
        .patch(`/api/parties/${CODE}/roll-style`)
        .set("x-test-user", user)
        .send({ rollStyle: "carousel" });

      expect(res.status).toBe(403);
    }

    expect(db.party.update).not.toHaveBeenCalled();
  });

  it("includes the style in the party, and in its version", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));
    const before = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_b");

    db.party.findUnique.mockResolvedValue({
      ...party(member("user_a", "Max"), member("user_b", "Sam")),
      rollStyle: "cover-die",
    });
    const after = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_b");
    const poll = await request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", "user_b");

    expect(before.body.data.rollStyle).toBe("classic");
    expect(after.body.data.rollStyle).toBe("cover-die");
    // A style change alone moves the version, so members pick it up on their next check.
    expect(after.body.data.version).not.toBe(before.body.data.version);
    expect(poll.body.data.version).toBe(after.body.data.version);
  });
});
