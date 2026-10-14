import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// No session at all: the preview must work for a crawler that is not signed in.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: () => ({ userId: null }),
}));
vi.mock("@clerk/express/webhooks", () => ({ verifyWebhook: vi.fn() }));

const db = vi.hoisted(() => ({ party: { findUnique: vi.fn() } }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { resetPublicRateLimits } from "../src/middleware/public-rate-limit.middleware";

const CODE = "abcDEF123_-x";
const URL = `/api/public/parties/${CODE}/preview`;
const GENERIC = { data: { active: false, name: null, memberCount: 0, hostName: null } };

const party = (expiresAt = new Date(Date.now() + 60 * 60 * 1000)) => ({
  name: "diddy party",
  hostId: "user_secret_host",
  expiresAt,
  members: [
    { userId: "user_secret_host", displayName: "Max" },
    { userId: "user_secret_two", displayName: "Private Pal" },
    { userId: "user_secret_three", displayName: "Another Pal" },
  ],
});

describe("party link preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPublicRateLimits();
  });

  it("returns the name, player count and host name without signing in", async () => {
    db.party.findUnique.mockResolvedValue(party());

    const res = await request(app).get(URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { active: true, name: "diddy party", memberCount: 3, hostName: "Max" },
    });
  });

  it("leaks no account IDs, other members, or party internals", async () => {
    db.party.findUnique.mockResolvedValue(party());

    const res = await request(app).get(URL);
    const text = JSON.stringify(res.body);

    expect(text).not.toContain("user_secret");
    expect(text).not.toContain("Private Pal");
    expect(text).not.toContain("Another Pal");
    expect(text).not.toContain(CODE);
    expect(Object.keys(res.body.data).sort()).toEqual(["active", "hostName", "memberCount", "name"]);
    // Only the fields the preview needs are requested from the database.
    expect(db.party.findUnique.mock.calls[0][0].select).toBeDefined();
    expect(db.party.findUnique.mock.calls[0][0].include).toBeUndefined();
  });

  it("answers unknown, expired and malformed codes identically", async () => {
    db.party.findUnique.mockResolvedValueOnce(null);
    const unknown = await request(app).get(URL);

    db.party.findUnique.mockResolvedValueOnce(party(new Date(Date.now() - 60 * 1000)));
    const expired = await request(app).get(URL);

    const malformed = await request(app).get("/api/public/parties/no/preview");

    for (const res of [unknown, expired, malformed]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(GENERIC);
    }
    // A malformed code never reaches the database.
    expect(db.party.findUnique).toHaveBeenCalledTimes(2);
  });

  it("keeps a long party active until its stored expiry", async () => {
    db.party.findUnique.mockResolvedValue(party(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)));
    const res = await request(app).get(URL);

    expect(res.body.data.active).toBe(true);
  });

  it("rate limits repeated requests from one address", async () => {
    db.party.findUnique.mockResolvedValue(null);

    let last = 200;
    for (let i = 0; i < 121; i++) last = (await request(app).get(URL)).status;

    expect(last).toBe(429);
  });

  it("does not expose the signed-in party routes", async () => {
    const res = await request(app).get(`/api/parties/${CODE}`);

    expect(res.status).toBe(401);
  });
});
