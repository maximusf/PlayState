import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: (req: Request) => ({ userId: req.headers["x-test-user"] ?? null }),
}));
vi.mock("@clerk/express/webhooks", () => ({ verifyWebhook: vi.fn() }));

const db = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  partyReaction: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { resetRateLimits } from "../src/middleware/rate-limit.middleware";
import { REACTION_EMOJI_IDS } from "../src/schemas/reaction.schema";
import { MAX_REACTIONS_PER_PARTY, REACTION_TTL_MS } from "../src/services/reaction.service";

const CODE = "abcDEF123_-x";
const URL = `/api/parties/${CODE}/reactions`;

const party = (overrides: Record<string, unknown> = {}) => ({
  id: "party_1",
  code: CODE,
  hostId: "user_a",
  removedUserIds: [] as string[],
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  members: [
    { id: "m_a", userId: "user_a", displayName: "Max" },
    { id: "m_b", userId: "user_b", displayName: "Sam" },
  ],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  db.party.findUnique.mockResolvedValue(party());
  db.partyReaction.create.mockImplementation(async ({ data }) => ({ id: "r_1", ...data }));
  db.partyReaction.findMany.mockResolvedValue([]);
  db.partyReaction.deleteMany.mockResolvedValue({ count: 0 });
});

describe("reaction ids", () => {
  it("match the emoji manifest in the web app", () => {
    const manifest = readFileSync(
      join(__dirname, "../../web/src/lib/party-cosmetics.ts"),
      "utf8",
    );
    const block = manifest.match(/REACTION_EMOJIS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
    const ids = [...block.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);

    expect(ids.length).toBeGreaterThan(0);
    expect([...REACTION_EMOJI_IDS]).toEqual(ids);
  });
});

describe("POST /api/parties/:code/reactions", () => {
  it("requires sign-in", async () => {
    const res = await request(app).post(URL).send({ emoji: "fire" });

    expect(res.status).toBe(401);
  });

  it("lets any member react, not only the host", async () => {
    const res = await request(app).post(URL).set("x-test-user", "user_b").send({ emoji: "fire" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: "r_1", emoji: "fire" });
    expect(db.partyReaction.create.mock.calls[0][0].data).toMatchObject({
      partyId: "party_1",
      userId: "user_b",
      emoji: "fire",
    });
  });

  it("refuses someone who is not in the party", async () => {
    const res = await request(app).post(URL).set("x-test-user", "user_z").send({ emoji: "fire" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PARTY_NOT_JOINED");
    expect(db.partyReaction.create).not.toHaveBeenCalled();
  });

  it("refuses a removed member", async () => {
    db.party.findUnique.mockResolvedValue(party({ removedUserIds: ["user_b"] }));
    const res = await request(app).post(URL).set("x-test-user", "user_b").send({ emoji: "fire" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PARTY_REMOVED");
    expect(db.partyReaction.create).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or expired party", async () => {
    db.party.findUnique.mockResolvedValueOnce(null);
    const missing = await request(app).post(URL).set("x-test-user", "user_a").send({ emoji: "fire" });
    db.party.findUnique.mockResolvedValueOnce(party({ expiresAt: new Date(Date.now() - 1000) }));
    const expired = await request(app).post(URL).set("x-test-user", "user_a").send({ emoji: "fire" });

    expect(missing.status).toBe(404);
    expect(expired.status).toBe(404);
  });

  it("accepts only known emoji ids", async () => {
    for (const body of [{ emoji: "poop" }, { emoji: 5 }, {}, { emoji: "fire; drop" }]) {
      const res = await request(app).post(URL).set("x-test-user", "user_a").send(body);
      expect(res.status).toBe(400);
    }
    expect(db.partyReaction.create).not.toHaveBeenCalled();
  });

  it("rate limits each player to 10 reactions per 10 seconds", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post(URL).set("x-test-user", "user_a").send({ emoji: "gg" });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);

    // Another player has their own allowance.
    const other = await request(app).post(URL).set("x-test-user", "user_b").send({ emoji: "gg" });
    expect(other.status).toBe(201);
  });

  it("prunes reactions older than a minute and anything past the cap", async () => {
    db.partyReaction.findMany.mockResolvedValue([{ id: "old_1" }, { id: "old_2" }]);
    const before = Date.now();
    await request(app).post(URL).set("x-test-user", "user_a").send({ emoji: "fire" });

    const [ageDelete, capDelete] = db.partyReaction.deleteMany.mock.calls.map((call) => call[0]);
    const cutoff = ageDelete.where.createdAt.lt.getTime();
    expect(ageDelete.where.partyId).toBe("party_1");
    expect(cutoff).toBeGreaterThanOrEqual(before - REACTION_TTL_MS - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - REACTION_TTL_MS + 1000);
    expect(db.partyReaction.findMany.mock.calls[0][0]).toMatchObject({
      where: { partyId: "party_1" },
      orderBy: { createdAt: "desc" },
      skip: MAX_REACTIONS_PER_PARTY,
    });
    expect(capDelete).toEqual({ where: { id: { in: ["old_1", "old_2"] } } });
  });

  it("skips the cap delete when the party is under the cap", async () => {
    await request(app).post(URL).set("x-test-user", "user_a").send({ emoji: "fire" });

    expect(db.partyReaction.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/parties/:code/reactions", () => {
  const row = (id: string, userId: string, createdAt: Date) => ({
    id,
    partyId: "party_1",
    userId,
    emoji: "heart",
    createdAt,
  });

  it("requires sign-in", async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });

  it("returns recent reactions with the sender's name and a cursor", async () => {
    const first = new Date(Date.now() - 5000);
    const second = new Date(Date.now() - 2000);
    db.partyReaction.findMany.mockResolvedValue([row("r_1", "user_a", first), row("r_2", "user_b", second)]);

    const res = await request(app).get(URL).set("x-test-user", "user_b");

    expect(res.status).toBe(200);
    expect(res.body.data.reactions).toEqual([
      { id: "r_1", emoji: "heart", userId: "user_a", displayName: "Max", createdAt: first.toISOString() },
      { id: "r_2", emoji: "heart", userId: "user_b", displayName: "Sam", createdAt: second.toISOString() },
    ]);
    expect(res.body.data.cursor).toBe(second.toISOString());
    expect(typeof res.body.data.serverNow).toBe("string");
  });

  it("uses the after cursor, but never reaches back past a minute", async () => {
    const after = new Date(Date.now() - 5000);
    await request(app).get(`${URL}?after=${encodeURIComponent(after.toISOString())}`).set("x-test-user", "user_a");
    expect(db.partyReaction.findMany.mock.calls[0][0].where.createdAt.gte).toEqual(after);

    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const res = await request(app)
      .get(`${URL}?after=${encodeURIComponent(stale.toISOString())}`)
      .set("x-test-user", "user_a");
    const floor = db.partyReaction.findMany.mock.calls[1][0].where.createdAt.gte as Date;

    expect(Date.now() - floor.getTime()).toBeLessThanOrEqual(REACTION_TTL_MS + 1000);
    expect(res.body.data.cursor).toBe(floor.toISOString());
  });

  it("rejects a cursor that is not a date", async () => {
    const res = await request(app).get(`${URL}?after=yesterday`).set("x-test-user", "user_a");

    expect(res.status).toBe(400);
  });

  it("keeps non-members and removed members out", async () => {
    const stranger = await request(app).get(URL).set("x-test-user", "user_z");
    db.party.findUnique.mockResolvedValue(party({ removedUserIds: ["user_b"] }));
    const removed = await request(app).get(URL).set("x-test-user", "user_b");

    expect(stranger.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(db.partyReaction.findMany).not.toHaveBeenCalled();
  });
});
