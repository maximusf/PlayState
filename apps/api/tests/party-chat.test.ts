import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  party: { findUnique: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
  partyMessage: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { resetRateLimits } from "../src/middleware/rate-limit.middleware";

const CODE = "abcDEF123_-x";
const URL = `/api/parties/${CODE}/messages`;

const chatParty = (overrides: Record<string, unknown> = {}) => ({
  id: "party_1",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  removedUserIds: [] as string[],
  // The query only asks for the viewer's own membership.
  members: [{ displayName: "Max" }],
  ...overrides,
});

const row = (id: string, userId: string, body: string, at = "2026-10-15T10:00:00.000Z") => ({
  id,
  partyId: "party_1",
  userId,
  displayName: userId === "user_a" ? "Max" : "Sam",
  body,
  createdAt: new Date(at),
});

const as = (userId: string) => ({ "x-test-user": userId });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.party.findUnique.mockResolvedValue(chatParty());
  db.partyMessage.findMany.mockResolvedValue([]);
  db.partyMessage.create.mockImplementation(async ({ data }) => ({
    id: "msg_new",
    createdAt: new Date("2026-10-15T10:05:00.000Z"),
    ...data,
  }));
});

describe("party chat", () => {
  it("requires authentication", async () => {
    const responses = await Promise.all([
      request(app).get(URL),
      request(app).post(URL).send({ body: "hi" }),
    ]);

    for (const res of responses) expect(res.status).toBe(401);
    expect(db.party.findUnique).not.toHaveBeenCalled();
  });

  it("lets a member read the latest messages, oldest first, without account IDs", async () => {
    // The database returns newest first.
    db.partyMessage.findMany.mockResolvedValue([
      row("m2", "user_b", "second", "2026-10-15T10:02:00.000Z"),
      row("m1", "user_a", "first", "2026-10-15T10:01:00.000Z"),
    ]);

    const res = await request(app).get(URL).set(as("user_a"));

    expect(res.status).toBe(200);
    expect(res.body.data.messages.map((m: { body: string }) => m.body)).toEqual(["first", "second"]);
    expect(res.body.data.messages[0]).toMatchObject({ displayName: "Max", isYou: true });
    expect(res.body.data.messages[1]).toMatchObject({ displayName: "Sam", isYou: false });
    expect(JSON.stringify(res.body)).not.toContain("user_");
    expect(db.party.findUnique.mock.calls[0][0].select.members).toEqual({
      where: { userId: "user_a" },
      select: { displayName: true },
    });
  });

  it("keeps people who never joined out", async () => {
    db.party.findUnique.mockResolvedValue(chatParty({ members: [] }));

    const read = await request(app).get(URL).set(as("user_z"));
    const write = await request(app).post(URL).set(as("user_z")).send({ body: "hi" });

    expect(read.status).toBe(403);
    expect(read.body.error.code).toBe("PARTY_NOT_JOINED");
    expect(write.status).toBe(403);
    expect(db.partyMessage.findMany).not.toHaveBeenCalled();
    expect(db.partyMessage.create).not.toHaveBeenCalled();
  });

  it("blocks a removed member from reading and sending", async () => {
    db.party.findUnique.mockResolvedValue(chatParty({ removedUserIds: ["user_a"] }));

    const read = await request(app).get(URL).set(as("user_a"));
    const write = await request(app).post(URL).set(as("user_a")).send({ body: "hi" });

    expect(read.status).toBe(403);
    expect(read.body.error.code).toBe("PARTY_REMOVED");
    expect(write.status).toBe(403);
    expect(db.partyMessage.findMany).not.toHaveBeenCalled();
    expect(db.partyMessage.create).not.toHaveBeenCalled();
  });

  it("treats a missing or expired party as gone", async () => {
    db.party.findUnique.mockResolvedValueOnce(null);
    db.party.findUnique.mockResolvedValueOnce(chatParty({ expiresAt: new Date(Date.now() - 1000) }));

    const missing = await request(app).get(URL).set(as("user_a"));
    const expired = await request(app).get(URL).set(as("user_a"));

    expect(missing.status).toBe(404);
    expect(expired.status).toBe(404);
  });

  it("sends a trimmed message and stores the sender's nickname", async () => {
    const res = await request(app).post(URL).set(as("user_a")).send({ body: "  <b>hi</b> there  " });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ body: "<b>hi</b> there", displayName: "Max", isYou: true });
    expect(db.partyMessage.create).toHaveBeenCalledWith({
      data: { partyId: "party_1", userId: "user_a", displayName: "Max", body: "<b>hi</b> there" },
    });
  });

  it("accepts exactly 200 characters and refuses 201", async () => {
    const ok = await request(app).post(URL).set(as("user_a")).send({ body: "a".repeat(200) });
    const tooLong = await request(app).post(URL).set(as("user_a")).send({ body: "a".repeat(201) });

    expect(ok.status).toBe(201);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe("VALIDATION_ERROR");
    expect(db.partyMessage.create).toHaveBeenCalledTimes(1);
  });

  it("refuses empty, blank, control character and non-text messages", async () => {
    const bodies = ["", "   ", "line one\nline two", "tab\there", "bell\u0007", "flip‮me", 42, null];

    for (const body of bodies) {
      const res = await request(app).post(URL).set(as("user_a")).send({ body });
      expect(res.status).toBe(400);
    }

    const missing = await request(app).post(URL).set(as("user_a")).send({});
    expect(missing.status).toBe(400);
    expect(db.partyMessage.create).not.toHaveBeenCalled();
  });

  it("prunes everything past the latest 100 after a send", async () => {
    db.partyMessage.findMany.mockResolvedValue([{ id: "old_2" }, { id: "old_1" }]);

    await request(app).post(URL).set(as("user_a")).send({ body: "hi" });

    expect(db.partyMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partyId: "party_1" }, skip: 100 }),
    );
    expect(db.partyMessage.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old_2", "old_1"] } } });
  });

  it("deletes nothing when the party is under the cap", async () => {
    await request(app).post(URL).set(as("user_a")).send({ body: "hi" });

    expect(db.partyMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("rate limits sending per player, not per party", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).post(URL).set(as("user_a")).send({ body: `msg ${i}` });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app).post(URL).set(as("user_a")).send({ body: "one more" });
    const other = await request(app).post(URL).set(as("user_b")).send({ body: "hello" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(other.status).toBe(201);
    expect(db.partyMessage.create).toHaveBeenCalledTimes(21);
  });

  it("does not rate limit reading, so polling is never refused", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app).get(URL).set(as("user_a"));
      expect(res.status).toBe(200);
    }
  });

  it("returns only newer messages after a cursor", async () => {
    const seenAt = new Date("2026-10-15T10:01:00.000Z");
    db.partyMessage.findFirst.mockResolvedValue({ createdAt: seenAt });
    db.partyMessage.findMany.mockResolvedValue([row("m3", "user_b", "third", "2026-10-15T10:03:00.000Z")]);

    const res = await request(app).get(`${URL}?after=m1`).set(as("user_a"));

    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(1);
    expect(db.partyMessage.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", partyId: "party_1" },
      select: { createdAt: true },
    });
    expect(db.partyMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          partyId: "party_1",
          OR: [{ createdAt: { gt: seenAt } }, { createdAt: seenAt, id: { gt: "m1" } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("only looks for the cursor inside the viewer's own party", async () => {
    // A cursor from another party is simply not found, so it falls back to the latest messages.
    db.partyMessage.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`${URL}?after=other_party_msg`).set(as("user_a"));

    expect(res.status).toBe(200);
    expect(db.partyMessage.findFirst.mock.calls[0][0].where).toEqual({
      id: "other_party_msg",
      partyId: "party_1",
    });
    expect(db.partyMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partyId: "party_1" }, take: 100 }),
    );
  });

  it("has no route for hosts, or anyone, to delete or edit a message", async () => {
    // user_a hosts in the real app. Nothing here can remove or change a line of chat.
    const attempts = await Promise.all([
      request(app).delete(`${URL}/m1`).set(as("user_a")),
      request(app).delete(URL).set(as("user_a")),
      request(app).patch(`${URL}/m1`).set(as("user_a")).send({ body: "edited" }),
      request(app).put(`${URL}/m1`).set(as("user_a")).send({ body: "edited" }),
    ]);

    for (const res of attempts) expect(res.status).toBe(404);
    expect(db.partyMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes messages with their party through the database cascade", () => {
    const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      join(__dirname, "../prisma/migrations/20261015000000_party_chat/migration.sql"),
      "utf8",
    );

    expect(schema).toMatch(/model PartyMessage[\s\S]*?onDelete: Cascade/);
    expect(schema).toMatch(/@@index\(\[partyId, createdAt\]\)/);
    expect(migration).toContain("ON DELETE CASCADE");
  });
});
