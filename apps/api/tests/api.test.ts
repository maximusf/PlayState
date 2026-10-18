import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Stand-in for Clerk: the "session" is whatever user ID the test header carries.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: (req: Request) => ({ userId: req.headers["x-test-user"] ?? null }),
}));

// Stand-in for Clerk's signature check: each test decides what a webhook verifies as.
const verifyWebhook = vi.hoisted(() => vi.fn());
vi.mock("@clerk/express/webhooks", () => ({ verifyWebhook }));

const db = vi.hoisted(() => ({
  userGame: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    groupBy: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  game: { upsert: vi.fn(), update: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  party: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  partyMember: { count: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  partyNomination: { upsert: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { Prisma } from "../src/generated/prisma/client";
import { resetRateLimits } from "../src/middleware/rate-limit.middleware";
import { resetTokenCache } from "../src/services/igdb.service";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// Answers the Twitch token request, then hands IGDB requests to the given reply.
function mockIgdb(reply: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes("id.twitch.tv") ? json({ access_token: "token", expires_in: 3600 }) : reply(),
  );
}

const hadesRow = {
  id: "game_1",
  igdbId: 113112,
  title: "Hades",
  coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
  releaseDate: new Date("2020-09-17"),
  genres: ["Role-playing (RPG)"],
  themes: ["Action"],
  gameModes: ["Single player"],
  timeToBeatHours: null as number | null,
};

const hadesEntry = {
  id: "entry_1",
  userId: "user_a",
  gameId: "game_1",
  createdAt: new Date("2026-10-08"),
  sessionLength: null as string | null,
  familyShared: false,
  game: hadesRow,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenCache();
  resetRateLimits();
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
  process.env.STEAM_API_KEY = "test-steam-key";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/health", () => {
  it("returns ok without authentication", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/stats", () => {
  it("counts players without authentication and without exposing user IDs", async () => {
    db.userGame.groupBy.mockResolvedValue([{ userId: "user_a" }, { userId: "user_b" }]);

    const res = await request(app).get("/api/stats");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { players: 2 } });
    expect(db.userGame.groupBy).toHaveBeenCalledWith({ by: ["userId"] });
  });
});

describe("POST /api/webhooks/clerk", () => {
  const send = () =>
    request(app)
      .post("/api/webhooks/clerk")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ type: "user.deleted", data: { id: "user_a" } }));

  it("rejects a request whose signature does not verify, and deletes nothing", async () => {
    verifyWebhook.mockRejectedValue(new Error("No matching signature found"));

    const res = await send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEBHOOK_INVALID");
    expect(db.userGame.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the library of a deleted account, using the verified user ID", async () => {
    // The verified event names user_b. The unverified body above says user_a.
    verifyWebhook.mockResolvedValue({ type: "user.deleted", data: { id: "user_b", deleted: true } });
    db.userGame.deleteMany.mockResolvedValue({ count: 12 });
    // They host two parties: one with another player in it, one where they are alone.
    db.party.findMany.mockResolvedValue([
      { id: "party_1", hostId: "user_b", members: [{ userId: "user_b" }, { userId: "user_c" }] },
      { id: "party_2", hostId: "user_b", members: [{ userId: "user_b" }] },
    ]);

    const res = await send();

    expect(res.status).toBe(200);
    expect(db.userGame.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_b" } });
    // A hosted party passes to the next player, or ends if nobody else is in it.
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { hostId: "user_c" },
    });
    expect(db.party.delete).toHaveBeenCalledWith({ where: { id: "party_2" } });
    expect(db.partyMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_b" } });
    // The signature is checked against the raw bytes, so the body must not be parsed first.
    expect(Buffer.isBuffer(verifyWebhook.mock.calls[0][0].body)).toBe(true);
  });

  it("acknowledges other events without touching any data", async () => {
    verifyWebhook.mockResolvedValue({ type: "user.created", data: { id: "user_c" } });

    const res = await send();

    expect(res.status).toBe(200);
    expect(db.userGame.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 500 when the delete fails, so Clerk retries", async () => {
    verifyWebhook.mockResolvedValue({ type: "user.deleted", data: { id: "user_b" } });
    db.userGame.deleteMany.mockRejectedValue(new Error("database unavailable"));

    const res = await send();

    expect(res.status).toBe(500);
  });
});

describe("unknown routes", () => {
  it("returns a consistent 404 error shape", async () => {
    const res = await request(app).get("/api/nope");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/catalog/search", () => {
  it("rejects a missing or too-short query with 400", async () => {
    for (const path of ["/api/catalog/search", "/api/catalog/search?q=%20a%20"]) {
      const res = await request(app).get(path).set("x-test-user", "user_a");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/catalog/search?q=hades");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits catalog requests per player", async () => {
    mockIgdb(() => json([]));
    const find = (user: string) =>
      request(app).get("/api/catalog/search?q=hades").set("x-test-user", user);

    for (let attempt = 0; attempt < 90; attempt++) {
      expect((await find("user_a")).status).toBe(200);
    }
    const blocked = await find("user_a");
    // Search and game details share one allowance, as both spend IGDB requests.
    const details = await request(app).get("/api/catalog/games/999").set("x-test-user", "user_a");
    const someoneElse = await find("user_b");

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(details.status).toBe(429);
    // One player hitting the limit does not block another.
    expect(someoneElse.status).toBe(200);
  });

  it("returns normalized results", async () => {
    mockIgdb(() =>
      json([
        {
          id: 113112,
          name: "Hades",
          cover: { image_id: "abc" },
          genres: [{ name: "Role-playing (RPG)" }],
          first_release_date: 1600300800,
          total_rating: 92.6,
          total_rating_count: 2100,
        },
        { id: 2, name: "No Metadata" },
      ]),
    );

    const res = await request(app).get("/api/catalog/search?q=hades").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        igdbId: 113112,
        title: "Hades",
        coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
        genres: ["Role-playing (RPG)"],
        releaseYear: 2020,
        releaseDate: "2020-09-17",
        rating: 93,
        ratingCount: 2100,
      },
      {
        igdbId: 2,
        title: "No Metadata",
        coverUrl: null,
        genres: [],
        releaseYear: null,
        releaseDate: null,
        rating: null,
        ratingCount: 0,
      },
    ]);
  });

  it("escapes quotes in the search term", async () => {
    mockIgdb(() => json([]));

    await request(app).get("/api/catalog/search").set("x-test-user", "user_a").query({ q: 'ha"des' });

    const igdbCall = fetchMock.mock.calls.find(([url]) => String(url).includes("igdb.com"));
    expect(igdbCall?.[1].body).toContain('search "ha\\"des";');
  });

  it("asks IGDB to leave out DLC and special editions", async () => {
    mockIgdb(() => json([]));

    await request(app).get("/api/catalog/search").set("x-test-user", "user_a").query({ q: "hades" });

    const igdbCall = fetchMock.mock.calls.find(([url]) => String(url).includes("igdb.com"));
    expect(igdbCall?.[1].body).toContain("game_type = (0,4,8,9,10,11)");
    expect(igdbCall?.[1].body).toContain("version_parent = null");
  });

  it("returns 502 when IGDB fails, without leaking upstream details", async () => {
    mockIgdb(() => json({ message: "upstream secret detail" }, 500));

    const res = await request(app).get("/api/catalog/search?q=hades").set("x-test-user", "user_a");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "IGDB_UNAVAILABLE", message: "The game catalog is unavailable right now." },
    });
  });

  it("returns 502 when the network request throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const res = await request(app).get("/api/catalog/search?q=hades").set("x-test-user", "user_a");

    expect(res.status).toBe(502);
  });

  it("refreshes the token once when IGDB rejects it", async () => {
    let igdbCalls = 0;
    mockIgdb(() => (++igdbCalls === 1 ? json({}, 401) : json([])));

    const res = await request(app).get("/api/catalog/search?q=hades").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(igdbCalls).toBe(2);
  });
});

describe("GET /api/catalog/games/:igdbId", () => {
  it("rejects a non-numeric id with 400", async () => {
    const res = await request(app).get("/api/catalog/games/abc").set("x-test-user", "user_a");

    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/catalog/games/999");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when IGDB has no such game", async () => {
    mockIgdb(() => json([]));

    const res = await request(app).get("/api/catalog/games/999").set("x-test-user", "user_a");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GAME_NOT_FOUND");
  });
});

describe("authentication", () => {
  it("rejects unauthenticated library and recommendation requests with 401", async () => {
    const responses = await Promise.all([
      request(app).get("/api/library"),
      request(app).post("/api/library").send({ igdbId: 1 }),
      request(app).delete("/api/library/entry_1"),
      request(app).post("/api/recommendations").send({}),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    }
    expect(db.userGame.findMany).not.toHaveBeenCalled();
    expect(db.userGame.deleteMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/library", () => {
  it("queries only the authenticated user's entries", async () => {
    db.userGame.findMany.mockResolvedValue([hadesEntry]);

    const res = await request(app).get("/api/library").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(db.userGame.findMany.mock.calls[0][0].where).toEqual({ userId: "user_a" });
    expect(res.body.data[0]).toMatchObject({ id: "entry_1", game: { igdbId: 113112 } });
    expect(res.body.data[0].userId).toBeUndefined();
  });
});

describe("GET /api/library/count", () => {
  it("counts only the authenticated user's games", async () => {
    db.userGame.count.mockResolvedValue(7);

    const res = await request(app).get("/api/library/count").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { count: 7 } });
    expect(db.userGame.count).toHaveBeenCalledWith({ where: { userId: "user_a" } });
    // It must not be mistaken for a library item called "count".
    expect(db.userGame.findFirst).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/library/count");

    expect(res.status).toBe(401);
  });
});

describe("GET /api/library/:id", () => {
  it("scopes the lookup to the authenticated user and adds IGDB details", async () => {
    db.userGame.findFirst.mockResolvedValue(hadesEntry);
    mockIgdb(() => json([{ id: 113112, name: "Hades", summary: "Escape the Underworld." }]));

    const res = await request(app).get("/api/library/entry_1").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(db.userGame.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "entry_1", userId: "user_a" } }),
    );
    expect(res.body.data.summary).toBe("Escape the Underworld.");
    expect(res.body.data.platforms).toEqual([]);
    expect(res.body.data.pickerChoices).toEqual(["Action", "RPG", "Single-player"]);
    expect(res.body.data.userId).toBeUndefined();
  });

  it("returns 404 when the entry belongs to another user", async () => {
    db.userGame.findFirst.mockResolvedValue(null);

    const res = await request(app).get("/api/library/entry_1").set("x-test-user", "user_b");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("LIBRARY_ITEM_NOT_FOUND");
  });

  it("still returns the entry when IGDB is unavailable", async () => {
    db.userGame.findFirst.mockResolvedValue(hadesEntry);
    mockIgdb(() => json({}, 500));

    const res = await request(app).get("/api/library/entry_1").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBeNull();
    expect(res.body.data.game.title).toBe("Hades");
  });
});

describe("oversized input", () => {
  it("rejects an over-long library ID, search and Steam profile before doing any work", async () => {
    const long = "x".repeat(300);
    const responses = await Promise.all([
      request(app).get(`/api/library/${long}`).set("x-test-user", "user_a"),
      request(app).get("/api/catalog/search").set("x-test-user", "user_a").query({ q: long }),
      request(app).post("/api/library/import/steam").set("x-test-user", "user_a").send({ profile: long }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.userGame.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a request body larger than the server accepts", async () => {
    const res = await request(app)
      .post("/api/parties")
      .set("x-test-user", "user_a")
      .send({ name: "x".repeat(200_000), displayName: "Max" });

    expect(res.status).toBe(413);
    expect(db.party.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/library/:id", () => {
  it("saves the session tag for the authenticated user's entry only", async () => {
    db.userGame.updateMany.mockResolvedValue({ count: 1 });
    db.userGame.findFirst.mockResolvedValue({ ...hadesEntry, sessionLength: "SHORT" });

    const res = await request(app)
      .patch("/api/library/entry_1")
      .set("x-test-user", "user_a")
      .send({ sessionLength: "SHORT" });

    expect(res.status).toBe(200);
    expect(db.userGame.updateMany).toHaveBeenCalledWith({
      where: { id: "entry_1", userId: "user_a" },
      data: { sessionLength: "SHORT" },
    });
    expect(res.body.data.sessionLength).toBe("SHORT");
  });

  it("accepts null to clear the tag and rejects unknown values", async () => {
    db.userGame.updateMany.mockResolvedValue({ count: 1 });
    db.userGame.findFirst.mockResolvedValue(hadesEntry);

    const cleared = await request(app)
      .patch("/api/library/entry_1")
      .set("x-test-user", "user_a")
      .send({ sessionLength: null });
    const invalid = await request(app)
      .patch("/api/library/entry_1")
      .set("x-test-user", "user_a")
      .send({ sessionLength: "FOREVER" });

    expect(cleared.status).toBe(200);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when the entry belongs to another user", async () => {
    db.userGame.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .patch("/api/library/entry_1")
      .set("x-test-user", "user_b")
      .send({ sessionLength: "LONG" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("LIBRARY_ITEM_NOT_FOUND");
  });
});

describe("POST /api/library", () => {
  it("rejects an invalid body with 400", async () => {
    for (const body of [{}, { igdbId: "113112" }, { igdbId: -1 }, { igdbId: 1.5 }]) {
      const res = await request(app).post("/api/library").set("x-test-user", "user_a").send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
  });

  it("saves canonical IGDB data and ignores client-supplied fields", async () => {
    mockIgdb(() => json([{ id: 113112, name: "Hades", game_modes: [{ name: "Single player" }] }]));
    db.game.upsert.mockResolvedValue(hadesRow);
    db.userGame.create.mockResolvedValue(hadesEntry);

    const res = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .send({ igdbId: 113112, title: "Fake Title", userId: "user_b" });

    expect(res.status).toBe(201);
    expect(db.game.upsert.mock.calls[0][0].create).toMatchObject({
      igdbId: 113112,
      title: "Hades",
      gameModes: ["Single player"],
    });
    expect(db.userGame.create.mock.calls[0][0].data).toEqual({
      userId: "user_a",
      gameId: "game_1",
      familyShared: false,
    });
  });

  it("returns 404 when the game does not exist in IGDB", async () => {
    mockIgdb(() => json([]));

    const res = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .send({ igdbId: 999 });

    expect(res.status).toBe(404);
    expect(db.game.upsert).not.toHaveBeenCalled();
  });

  it("returns 409 for a duplicate", async () => {
    mockIgdb(() => json([{ id: 113112, name: "Hades" }]));
    db.game.upsert.mockResolvedValue(hadesRow);
    db.userGame.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .send({ igdbId: 113112 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GAME_ALREADY_ADDED");
  });

  it("returns a generic 500 for unexpected database errors", async () => {
    mockIgdb(() => json([{ id: 113112, name: "Hades" }]));
    db.game.upsert.mockRejectedValue(new Error("connection string postgres://secret"));

    const res = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .send({ igdbId: 113112 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    });
  });
});

// Routes each outgoing request to Twitch, Steam, or IGDB by its URL.
// Steam replies are keyed by method name, IGDB replies by endpoint.
function mockSteamAndIgdb(replies: {
  steam?: Record<string, unknown>;
  igdb?: Record<string, unknown[]>;
}) {
  fetchMock.mockImplementation(async (input: string) => {
    const url = String(input);

    if (url.includes("id.twitch.tv")) return json({ access_token: "token", expires_in: 3600 });

    if (url.includes("api.steampowered.com")) {
      const method = Object.keys(replies.steam ?? {}).find((name) => url.includes(name));
      if (!method) return json({}, 500);

      // A reply can be a function of the URL, for methods called with different options.
      const reply = replies.steam?.[method];
      return json({ response: typeof reply === "function" ? reply(url) : reply });
    }

    const endpoint = url.split("/").pop() ?? "";
    return json(replies.igdb?.[endpoint] ?? []);
  });
}

function igdbBodies(endpoint: string): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith(`/v4/${endpoint}`))
    .map(([, init]) => String(init.body));
}

const steamLibrary = {
  games: [
    { appid: 367520, name: "Hollow Knight", playtime_forever: 0 },
    { appid: 1145360, name: "Hades", playtime_forever: 120 },
    { appid: 378648, name: "The Witcher 3: Blood and Wine", playtime_forever: 300 },
    { appid: 250820, name: "SteamVR", playtime_forever: 5 },
  ],
};

const steamMatches = [
  { uid: "1145360", game: { id: 113112, name: "Hades", game_type: 0, first_release_date: 1600300800 } },
  { uid: "367520", game: { id: 14593, name: "Hollow Knight", game_type: 0 } },
  { uid: "378648", game: { id: 13166, name: "Blood and Wine", game_type: 2 } },
];

describe("POST /api/library/import/steam", () => {
  const preview = (profile: unknown) =>
    request(app).post("/api/library/import/steam").set("x-test-user", "user_a").send({ profile });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/library/import/steam").send({ profile: "gabe" });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects input that is not a Steam profile with 400", async () => {
    for (const profile of [undefined, "", "not a profile!", "https://example.com/id/gabe"]) {
      const res = await preview(profile);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches Steam games to IGDB and flags the ones already in the library", async () => {
    mockSteamAndIgdb({
      steam: {
        ResolveVanityURL: { success: 1, steamid: "76561197960287930" },
        GetOwnedGames: steamLibrary,
      },
      igdb: { external_games: steamMatches },
    });
    // Hollow Knight was added by hand earlier.
    db.userGame.findMany.mockResolvedValue([{ game: { igdbId: 14593 } }]);

    const res = await preview("https://steamcommunity.com/id/gabe/");

    expect(res.status).toBe(200);
    expect(res.body.data.games).toEqual([
      expect.objectContaining({
        igdbId: 113112,
        title: "Hades",
        releaseYear: 2020,
        playtimeMinutes: 120,
        inLibrary: false,
      }),
      expect.objectContaining({
        igdbId: 14593,
        playtimeMinutes: 0,
        lastPlayedAt: null,
        inLibrary: true,
      }),
    ]);
    // DLC and tools are not games a player would add.
    expect(res.body.data.unmatched).toEqual(["SteamVR", "The Witcher 3: Blood and Wine"]);
    expect(db.userGame.findMany.mock.calls[0][0].where.userId).toBe("user_a");
    expect(igdbBodies("external_games")[0]).toContain(
      'where external_game_source = 1 & uid = ("367520","1145360","378648","250820")',
    );
    expect(db.game.createMany).not.toHaveBeenCalled();
    expect(db.userGame.createMany).not.toHaveBeenCalled();
  });

  it("never passes a malformed Steam app ID into an IGDB query", async () => {
    mockSteamAndIgdb({
      steam: {
        GetOwnedGames: {
          games: [
            { appid: 620, name: "Portal 2" },
            { appid: '1"); fields *; where id = ("1', name: "Not a real app" },
            { appid: 1.5, name: "Also not real" },
          ],
        },
      },
      igdb: { external_games: [] },
    });
    db.userGame.findMany.mockResolvedValue([]);

    const res = await preview("76561197960287930");

    expect(res.status).toBe(200);
    expect(igdbBodies("external_games")).toHaveLength(1);
    expect(igdbBodies("external_games")[0]).toContain('uid = ("620");');
  });

  it("uses a numeric Steam ID directly", async () => {
    mockSteamAndIgdb({ steam: { GetOwnedGames: steamLibrary }, igdb: { external_games: [] } });
    db.userGame.findMany.mockResolvedValue([]);

    const res = await preview("https://steamcommunity.com/profiles/76561197960287930");

    expect(res.status).toBe(200);
    const steamUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(steamUrls.some((url) => url.includes("ResolveVanityURL"))).toBe(false);
    expect(steamUrls.some((url) => url.includes("steamid=76561197960287930"))).toBe(true);
  });

  it("counts a special edition as the game it is an edition of", async () => {
    mockSteamAndIgdb({
      steam: {
        GetOwnedGames: {
          games: [
            { appid: 1, name: "Hades", playtime_forever: 60, rtime_last_played: 1600300800 },
            {
              appid: 2,
              name: "Hades: Deluxe Edition",
              playtime_forever: 30,
              rtime_last_played: 1700000000,
            },
          ],
        },
      },
      igdb: {
        external_games: [
          { uid: "1", game: { id: 113112, name: "Hades", game_type: 0 } },
          { uid: "2", game: { id: 500, name: "Hades: Deluxe Edition", version_parent: 113112 } },
        ],
        games: [{ id: 113112, name: "Hades", game_type: 0 }],
      },
    });
    db.userGame.findMany.mockResolvedValue([]);

    const res = await preview("76561197960287930");

    expect(res.body.data.games).toHaveLength(1);
    // Playtime is added up, and the most recent session of the two is kept.
    expect(res.body.data.games[0]).toMatchObject({
      igdbId: 113112,
      playtimeMinutes: 90,
      lastPlayedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(res.body.data.unmatched).toEqual([]);
  });

  it("marks games the player never paid for as free", async () => {
    const hades = { appid: 1145360, name: "Hades", playtime_forever: 120 };
    const hollowKnight = { appid: 367520, name: "Hollow Knight", playtime_forever: 40 };

    mockSteamAndIgdb({
      steam: {
        // Hollow Knight stands in for a free-to-play game: Steam only lists it when asked to.
        GetOwnedGames: (url: string) => ({
          games: url.includes("include_played_free_games=true") ? [hades, hollowKnight] : [hades],
        }),
      },
      igdb: { external_games: steamMatches },
    });
    db.userGame.findMany.mockResolvedValue([]);

    const res = await preview("76561197960287930");

    expect(res.body.data.games).toEqual([
      expect.objectContaining({ igdbId: 113112, free: false }),
      expect.objectContaining({ igdbId: 14593, free: true }),
    ]);
  });

  it("returns 404 when the profile name does not exist", async () => {
    mockSteamAndIgdb({ steam: { ResolveVanityURL: { success: 42, message: "No match" } } });

    const res = await preview("nobody-here");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("STEAM_PROFILE_NOT_FOUND");
  });

  it("explains the privacy setting when Steam shares no games", async () => {
    mockSteamAndIgdb({ steam: { GetOwnedGames: {} } });

    const res = await preview("76561197960287930");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("STEAM_LIBRARY_HIDDEN");
    expect(res.body.error.message).toContain("Game details to Public");
  });

  it("returns 502 when Steam fails, without leaking the API key", async () => {
    mockSteamAndIgdb({});
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await preview("76561197960287930");

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("STEAM_UNAVAILABLE");
    expect(JSON.stringify([res.body, logged.mock.calls])).not.toContain("test-steam-key");
  });

  it("allows each player 5 loaded libraries an hour", async () => {
    mockSteamAndIgdb({ steam: { GetOwnedGames: steamLibrary }, igdb: { external_games: [] } });
    db.userGame.findMany.mockResolvedValue([]);
    const look = (user: string, profile = "76561197960287930") =>
      request(app).post("/api/library/import/steam").set("x-test-user", user).send({ profile });

    // A mistyped link does not use up a preview.
    expect((await look("user_a", "not a profile!")).status).toBe(400);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await look("user_a")).status).toBe(200);
    }
    const steamCalls = fetchMock.mock.calls.length;
    const blocked = await look("user_a");

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(blocked.body.error.message).toContain("this hour");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // A blocked preview never reaches Steam or IGDB.
    expect(fetchMock).toHaveBeenCalledTimes(steamCalls);
    // One player hitting the limit does not block another.
    expect((await look("user_b")).status).toBe(200);
  });

  it("rate limits failed previews per player", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await preview("not a profile!")).status).toBe(400);
    }
    const blocked = await preview("not a profile!");

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toContain("too quickly");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("POST /api/library with the family tag", () => {
  it("saves the tag, and defaults to untagged", async () => {
    mockIgdb(() => json([{ id: 113112, name: "Hades" }]));
    db.game.upsert.mockResolvedValue(hadesRow);
    db.userGame.create.mockResolvedValue({ ...hadesEntry, familyShared: true });

    const tagged = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .send({ igdbId: 113112, familyShared: true });

    expect(tagged.status).toBe(201);
    expect(tagged.body.data.familyShared).toBe(true);
    expect(db.userGame.create.mock.calls[0][0].data).toEqual({
      userId: "user_a",
      gameId: "game_1",
      familyShared: true,
    });

    await request(app).post("/api/library").set("x-test-user", "user_a").send({ igdbId: 113112 });

    expect(db.userGame.create.mock.calls[1][0].data.familyShared).toBe(false);
  });

  it("rejects a tag that is not true or false", async () => {
    const res = await request(app)
      .post("/api/library")
      .set("x-test-user", "user_a")
      .send({ igdbId: 113112, familyShared: "yes" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/library/delete", () => {
  const deleteMany = (body: unknown, user = "user_a") =>
    request(app)
      .post("/api/library/delete")
      .set("x-test-user", user)
      .send(body as object);

  it("requires authentication", async () => {
    const res = await request(app).post("/api/library/delete").send({ ids: ["a"] });

    expect(res.status).toBe(401);
  });

  it("rejects an invalid body with 400 and deletes nothing", async () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => `id_${index}`);

    for (const body of [{}, { ids: [] }, { ids: "a" }, { ids: [1] }, { ids: [""] }, { ids: tooMany }]) {
      const res = await deleteMany(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(db.userGame.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes only the signed-in user's entries, once each", async () => {
    db.userGame.deleteMany.mockResolvedValue({ count: 2 });

    const res = await deleteMany({ ids: ["entry_1", "entry_2", "entry_2"], userId: "user_b" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: 2 });
    expect(db.userGame.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["entry_1", "entry_2"] }, userId: "user_a" },
    });
  });

  it("is rate limited per user", async () => {
    db.userGame.deleteMany.mockResolvedValue({ count: 1 });

    for (let index = 0; index < 20; index++) {
      expect((await deleteMany({ ids: ["entry_1"] })).status).toBe(200);
    }
    const blocked = await deleteMany({ ids: ["entry_1"] });

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await deleteMany({ ids: ["entry_1"] }, "user_b")).status).toBe(200);
  });
});

describe("POST /api/library/import", () => {
  const importGames = (body: unknown) =>
    request(app)
      .post("/api/library/import")
      .set("x-test-user", "user_a")
      .send(body as object);

  it("requires authentication", async () => {
    const res = await request(app).post("/api/library/import").send({ igdbIds: [1] });

    expect(res.status).toBe(401);
  });

  it("rejects an invalid body with 400", async () => {
    for (const body of [{}, { igdbIds: [] }, { igdbIds: "1" }, { igdbIds: [1.5] }, { igdbIds: [-1] }]) {
      const res = await importGames(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(db.userGame.createMany).not.toHaveBeenCalled();
  });

  it("stores only the games it has not seen and skips library duplicates", async () => {
    mockSteamAndIgdb({
      igdb: {
        games: [{ id: 14593, name: "Hollow Knight", genres: [{ name: "Platform" }] }],
        game_time_to_beats: [{ game_id: 14593, normally: 129814 }],
      },
    });
    // Hades is already stored. Hollow Knight is new to PlayState.
    db.game.findMany
      .mockResolvedValueOnce([{ igdbId: 113112 }])
      .mockResolvedValueOnce([{ id: "game_1" }, { id: "game_2" }]);
    db.game.createMany.mockResolvedValue({ count: 1 });
    // Hades is already in this user's library, so only one row is new.
    db.userGame.createMany.mockResolvedValue({ count: 1 });

    const res = await importGames({ igdbIds: [113112, 14593, 14593], userId: "user_b" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ added: 1, skipped: 1 });
    expect(igdbBodies("games")[0]).toContain("where id = (14593);");
    expect(db.game.createMany.mock.calls[0][0]).toMatchObject({
      data: [{ igdbId: 14593, title: "Hollow Knight", genres: ["Platform"], timeToBeatHours: 36 }],
      skipDuplicates: true,
    });
    expect(db.userGame.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user_a", gameId: "game_1" },
        { userId: "user_a", gameId: "game_2" },
      ],
      skipDuplicates: true,
    });
  });

  it("does not call IGDB when every game is already stored", async () => {
    db.game.findMany
      .mockResolvedValueOnce([{ igdbId: 113112 }])
      .mockResolvedValueOnce([{ id: "game_1" }]);
    db.userGame.createMany.mockResolvedValue({ count: 1 });

    const res = await importGames({ igdbIds: [113112] });

    expect(res.body.data).toEqual({ added: 1, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.game.createMany).not.toHaveBeenCalled();
  });

  it("still imports when time to beat is unavailable", async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes("id.twitch.tv")) return json({ access_token: "token", expires_in: 3600 });
      return url.endsWith("/game_time_to_beats") ? json({}, 500) : json([{ id: 14593, name: "Hollow Knight" }]);
    });
    db.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "game_2" }]);
    db.userGame.createMany.mockResolvedValue({ count: 1 });

    const res = await importGames({ igdbIds: [14593] });

    expect(res.status).toBe(200);
    expect(db.game.createMany.mock.calls[0][0].data[0].timeToBeatHours).toBeNull();
  });

  it("allows each player 3 imports an hour", async () => {
    // Hades is already stored, so no import here needs IGDB.
    db.game.findMany.mockResolvedValue([{ id: "game_1", igdbId: 113112 }]);
    db.userGame.createMany.mockResolvedValue({ count: 1 });
    const bring = (user: string) =>
      request(app).post("/api/library/import").set("x-test-user", user).send({ igdbIds: [113112] });

    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await bring("user_a")).status).toBe(200);
    }
    const blocked = await bring("user_a");
    const someoneElse = await bring("user_b");

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(blocked.body.error.message).toContain("this hour");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // One player hitting the limit does not block another.
    expect(someoneElse.status).toBe(200);
    expect(db.userGame.createMany).toHaveBeenCalledTimes(4);
  });

  it("does not count an import that added nothing, but rate limits repeating it", async () => {
    db.game.findMany.mockResolvedValue([{ id: "game_1", igdbId: 113112 }]);
    // Every game sent is already in the library.
    db.userGame.createMany.mockResolvedValue({ count: 0 });

    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await importGames({ igdbIds: [113112] })).status).toBe(200);
    }
    const blocked = await importGames({ igdbIds: [113112] });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toContain("too quickly");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("DELETE /api/library/:id", () => {
  it("scopes the delete to the authenticated user", async () => {
    db.userGame.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete("/api/library/entry_1").set("x-test-user", "user_a");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(db.userGame.deleteMany).toHaveBeenCalledWith({
      where: { id: "entry_1", userId: "user_a" },
    });
  });

  it("returns 404 when the entry belongs to another user", async () => {
    // The scoped query matches nothing for user_b, so nothing is deleted.
    db.userGame.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app).delete("/api/library/entry_1").set("x-test-user", "user_b");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("LIBRARY_ITEM_NOT_FOUND");
    expect(db.userGame.deleteMany).toHaveBeenCalledWith({
      where: { id: "entry_1", userId: "user_b" },
    });
  });
});

describe("parties", () => {
  const CODE = "abcDEF123_-x";
  const member = (userId: string, displayName: string) => ({
    id: `member_${displayName.toLowerCase()}`,
    partyId: "party_1",
    userId,
    displayName,
  });
  const party = (...members: ReturnType<typeof member>[]) => ({
    id: "party_1",
    code: CODE,
    name: "Friday night",
    // user_a started every party in these tests.
    hostId: "user_a",
    removedUserIds: [] as string[],
    rolledIgdbId: null as number | null,
    rolledAt: null as Date | null,
    ignoreLimits: false,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    extended: false,
    createdAt: new Date(),
    members,
    nominations: [] as { userId: string; igdbId: number }[],
  });
  const game = (id: string, title: string, gameModes: string[]) => ({
    id,
    igdbId: Number(id.replace("game_", "")),
    title,
    coverUrl: null,
    genres: ["Shooter"],
    gameModes,
  });
  const owns = (userId: string, owned: ReturnType<typeof game>) => ({
    id: `entry_${userId}_${owned.id}`,
    userId,
    gameId: owned.id,
    game: owned,
  });

  it("requires authentication on every route", async () => {
    const responses = await Promise.all([
      request(app).get("/api/parties"),
      request(app).post("/api/parties").send({ name: "x", displayName: "y" }),
      request(app).get(`/api/parties/${CODE}`),
      request(app).get(`/api/parties/${CODE}/invite`),
      request(app).post(`/api/parties/${CODE}/members`).send({ displayName: "y" }),
      request(app).delete(`/api/parties/${CODE}/members/me`),
      request(app).delete(`/api/parties/${CODE}`),
    ]);

    for (const res of responses) expect(res.status).toBe(401);
    expect(db.party.findUnique).not.toHaveBeenCalled();
  });

  it("creates a party with an unguessable code and the creator as its first member", async () => {
    db.party.count.mockResolvedValue(0);
    db.partyMember.count.mockResolvedValue(0);
    db.party.create.mockImplementation(async ({ data }) => ({
      id: "party_1",
      createdAt: new Date(),
      extended: false,
      ...data,
    }));

    const res = await request(app)
      .post("/api/parties")
      .set("x-test-user", "user_a")
      .send({ name: "  Friday night ", displayName: " Max ", userId: "user_b" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Friday night",
      memberCount: 1,
      extended: false,
    });
    // With no length chosen, a party lasts one day from when it was started.
    const lasts = new Date(res.body.data.expiresAt).getTime() - Date.now();
    expect(Math.abs(lasts - 24 * 60 * 60 * 1000)).toBeLessThan(5000);
    expect(res.body.data.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(db.party.create.mock.calls[0][0].data).toMatchObject({
      hostId: "user_a",
      members: { create: { userId: "user_a", displayName: "Max" } },
    });
    expect(res.body.data.isHost).toBe(true);
  });

  it("stops a player from being in more than three parties, hosted or joined", async () => {
    // Already in three parties, whether they started them or joined them.
    db.partyMember.count.mockResolvedValue(3);
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max")));

    const start = await request(app)
      .post("/api/parties")
      .set("x-test-user", "user_b")
      .send({ name: "One too many", displayName: "Sam" });
    const join = await request(app)
      .post(`/api/parties/${CODE}/members`)
      .set("x-test-user", "user_b")
      .send({ displayName: "Sam" });

    for (const res of [start, join]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PARTY_LIMIT_REACHED");
    }
    expect(db.partyMember.count).toHaveBeenCalledWith({ where: { userId: "user_b" } });
    expect(db.party.create).not.toHaveBeenCalled();
    expect(db.partyMember.upsert).not.toHaveBeenCalled();
  });

  it("rate limits party creation per player", async () => {
    db.party.count.mockResolvedValue(0);
    db.partyMember.count.mockResolvedValue(0);
    db.party.create.mockImplementation(async ({ data }) => ({ id: "p", createdAt: new Date(), ...data }));
    const start = (user: string) =>
      request(app).post("/api/parties").set("x-test-user", user).send({ name: "Squad", displayName: "Max" });

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await start("user_a")).status).toBe(201);
    }
    const blocked = await start("user_a");
    const someoneElse = await start("user_b");

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // One player hitting the limit does not block another.
    expect(someoneElse.status).toBe(201);
    expect(db.party.create).toHaveBeenCalledTimes(6);
  });

  it("stores a name that looks like a database command as plain text", async () => {
    db.party.count.mockResolvedValue(0);
    db.partyMember.count.mockResolvedValue(0);
    db.party.create.mockImplementation(async ({ data }) => ({ id: "p", createdAt: new Date(), ...data }));
    const name = "'; DROP TABLE \"Party\"; --";
    const displayName = "<b>Max</b>";

    const res = await request(app)
      .post("/api/parties")
      .set("x-test-user", "user_a")
      .send({ name, displayName });

    // It is handed to the database as a value, exactly as typed. It is never part of a query.
    expect(res.status).toBe(201);
    expect(db.party.create.mock.calls[0][0].data).toMatchObject({
      name,
      members: { create: { userId: "user_a", displayName } },
    });
  });

  it("tidies spacing in names and rejects control and text-direction characters", async () => {
    db.party.count.mockResolvedValue(0);
    db.partyMember.count.mockResolvedValue(0);
    db.party.create.mockImplementation(async ({ data }) => ({ id: "p", createdAt: new Date(), ...data }));
    const start = (name: string, displayName: string) => {
      // This test is about names, so the creation limit is kept out of the way.
      resetRateLimits();
      return request(app).post("/api/parties").set("x-test-user", "user_a").send({ name, displayName });
    };

    const tidy = await start("  Friday    night  ", "Max");
    expect(tidy.status).toBe(201);
    expect(db.party.create.mock.calls[0][0].data.name).toBe("Friday night");

    for (const bad of ["line\nbreak", "tab\tbed", "null\u0000byte", "flip\u202Edetrevni"]) {
      const res = await start("Squad", bad);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    // Forty-one characters is one over the party name limit. A name of only spaces is empty.
    expect((await start("x".repeat(41), "Max")).status).toBe(400);
    expect((await start("     ", "Max")).status).toBe(400);
    expect(db.party.create).toHaveBeenCalledTimes(1);
  });

  it("accepts emoji and other scripts in names, and refuses half an emoji", async () => {
    db.partyMember.count.mockResolvedValue(0);
    db.party.create.mockImplementation(async ({ data }) => ({ id: "p", createdAt: new Date(), ...data }));
    const start = (name: string, displayName: string) => {
      resetRateLimits();
      return request(app).post("/api/parties").set("x-test-user", "user_a").send({ name, displayName });
    };

    // A family emoji is several characters joined invisibly. It must survive untouched.
    const name = "金曜の夜 🎮";
    const displayName = "Zoë 👨‍👩‍👧";
    const ok = await start(name, displayName);

    expect(ok.status).toBe(201);
    expect(db.party.create.mock.calls[0][0].data).toMatchObject({
      name,
      members: { create: { userId: "user_a", displayName } },
    });

    // The first half of an emoji with its second half cut off.
    const broken = await start("Squad", "Max\ud83c");

    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("VALIDATION_ERROR");
    expect(db.party.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid party or display name with 400", async () => {
    for (const body of [{}, { name: "", displayName: "Max" }, { name: "Squad", displayName: "x".repeat(25) }]) {
      const res = await request(app).post("/api/parties").set("x-test-user", "user_a").send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(db.party.create).not.toHaveBeenCalled();
  });

  it("shows an invite's name and size, but no members or games, before joining", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const res = await request(app).get(`/api/parties/${CODE}/invite`).set("x-test-user", "user_c");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ code: CODE, name: "Friday night", memberCount: 2, joined: false });
    expect(res.body.data.members).toBeUndefined();
    expect(db.userGame.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 for a party that does not exist", async () => {
    db.party.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/parties/${CODE}/invite`).set("x-test-user", "user_a");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PARTY_NOT_FOUND");
  });

  it("starts a party for the length the host chose, and refuses any other", async () => {
    db.party.count.mockResolvedValue(0);
    db.partyMember.count.mockResolvedValue(0);
    db.party.create.mockImplementation(async ({ data }) => ({
      id: "p",
      createdAt: new Date(),
      extended: false,
      ...data,
    }));
    const start = (lifetimeHours: number) =>
      request(app)
        .post("/api/parties")
        .set("x-test-user", "user_a")
        .send({ name: "Squad", displayName: "Max", lifetimeHours });

    const short = await start(3);
    const week = await start(168);
    const odd = await start(5);

    const lasts = (res: { body: { data: { expiresAt: string } } }) =>
      new Date(res.body.data.expiresAt).getTime() - Date.now();
    expect(Math.abs(lasts(short) - 3 * 60 * 60 * 1000)).toBeLessThan(5000);
    expect(Math.abs(lasts(week) - 7 * 24 * 60 * 60 * 1000)).toBeLessThan(5000);
    expect(odd.status).toBe(400);
  });

  it("lets only the host extend a party, and only once", async () => {
    const base = party(member("user_a", "Max"), member("user_b", "Sam"));
    db.party.findUnique.mockResolvedValue(base);
    db.party.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const notHost = await request(app).post(`/api/parties/${CODE}/extend`).set("x-test-user", "user_b");
    const first = await request(app).post(`/api/parties/${CODE}/extend`).set("x-test-user", "user_a");
    const second = await request(app).post(`/api/parties/${CODE}/extend`).set("x-test-user", "user_a");

    expect(notHost.status).toBe(403);
    expect(first.status).toBe(200);
    expect(first.body.data.extended).toBe(true);
    expect(new Date(first.body.data.expiresAt).getTime()).toBe(
      base.expiresAt.getTime() + 24 * 60 * 60 * 1000,
    );
    expect(db.party.updateMany.mock.calls[0][0].where).toEqual({ id: "party_1", extended: false });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PARTY_ALREADY_EXTENDED");
  });

  it("lets the host hand the party to another member without leaving", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const handed = await request(app)
      .post(`/api/parties/${CODE}/host`)
      .set("x-test-user", "user_a")
      .send({ memberId: "member_sam" });
    const notHost = await request(app)
      .post(`/api/parties/${CODE}/host`)
      .set("x-test-user", "user_b")
      .send({ memberId: "member_sam" });
    const stranger = await request(app)
      .post(`/api/parties/${CODE}/host`)
      .set("x-test-user", "user_a")
      .send({ memberId: "member_nobody" });
    const self = await request(app)
      .post(`/api/parties/${CODE}/host`)
      .set("x-test-user", "user_a")
      .send({ memberId: "member_max" });

    expect(handed.status).toBe(204);
    expect(db.party.update).toHaveBeenCalledTimes(1);
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { hostId: "user_b" },
    });
    expect(notHost.status).toBe(403);
    expect(stranger.status).toBe(404);
    expect(self.status).toBe(409);
    expect(db.partyMember.deleteMany).not.toHaveBeenCalled();
  });

  it("treats an expired party as gone, and clears expired parties out", async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    db.party.findUnique.mockResolvedValue({ ...party(member("user_a", "Max")), expiresAt: hourAgo });
    db.party.findMany.mockResolvedValue([]);

    const expired = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_a");
    await request(app).get("/api/parties").set("x-test-user", "user_a");

    expect(expired.status).toBe(404);
    expect(expired.body.error.code).toBe("PARTY_NOT_FOUND");
    expect(db.userGame.findMany).not.toHaveBeenCalled();

    const cutoff = db.party.deleteMany.mock.calls[0][0].where.expiresAt.lte as Date;
    expect(Math.abs(cutoff.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("joins a party as the signed-in user", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max")));
    db.partyMember.count.mockResolvedValue(0);

    const res = await request(app)
      .post(`/api/parties/${CODE}/members`)
      .set("x-test-user", "user_b")
      .send({ displayName: "Sam", userId: "user_z" });

    expect(res.status).toBe(200);
    expect(res.body.data.memberCount).toBe(2);
    expect(db.partyMember.upsert).toHaveBeenCalledWith({
      where: { partyId_userId: { partyId: "party_1", userId: "user_b" } },
      create: { partyId: "party_1", userId: "user_b", displayName: "Sam" },
      update: { displayName: "Sam" },
    });
  });

  it("refuses a new member when the party is full", async () => {
    const twelve = Array.from({ length: 12 }, (_, index) => member(`user_${index}`, `P${index}`));
    db.party.findUnique.mockResolvedValue(party(...twelve));

    const res = await request(app)
      .post(`/api/parties/${CODE}/members`)
      .set("x-test-user", "user_new")
      .send({ displayName: "Late" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PARTY_FULL");
    expect(db.partyMember.upsert).not.toHaveBeenCalled();
  });

  it("hides a party's members and games from someone who has not joined", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const res = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_c");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PARTY_NOT_JOINED");
    expect(db.userGame.findMany).not.toHaveBeenCalled();
  });

  it("lists the multiplayer games everyone owns, and the ones one player is missing", async () => {
    const halo = game("game_1", "Halo Infinite", ["Single player", "Multiplayer"]);
    const portal = game("game_2", "Portal 2", ["Single player", "Co-operative"]);
    const hades = game("game_3", "Hades", ["Single player"]);
    const rocket = game("game_4", "Rocket League", ["Multiplayer"]);

    db.party.findUnique.mockResolvedValue(
      party(member("user_a", "Max"), member("user_b", "Sam"), member("user_c", "Rio")),
    );
    db.userGame.findMany.mockResolvedValue([
      // Everyone owns Halo and Hades. Rio lacks Portal 2. Only Max owns Rocket League.
      owns("user_a", halo), owns("user_b", halo), owns("user_c", halo),
      owns("user_a", hades), owns("user_b", hades), owns("user_c", hades),
      owns("user_a", portal), owns("user_b", portal),
      owns("user_a", rocket),
    ]);

    // IGDB has a player limit for Halo and nothing for Portal 2.
    mockSteamAndIgdb({
      igdb: {
        multiplayer_modes: [
          { game: 1, onlinemax: 24, offlinemax: 2 },
          { game: 1, onlinemax: 12 },
        ],
      },
    });

    const res = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(igdbBodies("multiplayer_modes")[0]).toContain("where game = (1,2);");
    expect(db.userGame.findMany.mock.calls[0][0].where).toEqual({
      userId: { in: ["user_a", "user_b", "user_c"] },
    });
    // Hades is owned by all three but is single-player only, so it is left out.
    expect(res.body.data.shared).toEqual([
      expect.objectContaining({
        title: "Halo Infinite",
        libraryEntryId: "entry_user_a_game_1",
        // The largest figure across platforms.
        maxPlayers: 24,
      }),
    ]);
    expect(res.body.data.almost).toEqual([
      expect.objectContaining({ title: "Portal 2", missing: "Rio", missingIsYou: false, maxPlayers: null }),
    ]);
    // Rocket League is only in the viewer's own library, so only the viewer is shown it.
    expect(res.body.data.others).toEqual([expect.objectContaining({ title: "Rocket League" })]);
    expect(res.body.data.members).toEqual([
      { id: "member_max", displayName: "Max", isYou: true, isHost: true },
      { id: "member_sam", displayName: "Sam", isYou: false, isHost: false },
      { id: "member_rio", displayName: "Rio", isYou: false, isHost: false },
    ]);
    expect(res.body.data.isHost).toBe(true);
    expect(res.body.data).toMatchObject({ rolledIgdbId: null, rolledAt: null });
    expect(res.body.data.version).toEqual(expect.any(String));
    // Members know each other by display name only.
    expect(JSON.stringify(res.body)).not.toContain("user_b");
  });

  it("still lists the shared games when IGDB cannot be reached for player limits", async () => {
    const halo = game("game_1", "Halo Infinite", ["Multiplayer"]);
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));
    db.userGame.findMany.mockResolvedValue([owns("user_a", halo), owns("user_b", halo)]);
    fetchMock.mockRejectedValue(new Error("network down"));

    const res = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(res.body.data.shared).toEqual([
      expect.objectContaining({ title: "Halo Infinite", maxPlayers: null }),
    ]);
  });

  it("does not list near misses for a party of two", async () => {
    const halo = game("game_1", "Halo Infinite", ["Multiplayer"]);
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));
    db.userGame.findMany.mockResolvedValue([owns("user_a", halo)]);

    const res = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_a");

    expect(res.body.data.shared).toEqual([]);
    expect(res.body.data.almost).toEqual([]);
    expect(res.body.data.others).toEqual([expect.objectContaining({ title: "Halo Infinite" })]);

    // The other player does not own it, so it must not appear on their page at all.
    const theirs = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_b");
    expect(theirs.body.data.others).toEqual([]);
  });

  it("lets a member leave without ending the party", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));
    const left = await request(app)
      .delete(`/api/parties/${CODE}/members/me`)
      .set("x-test-user", "user_b");
    const stranger = await request(app)
      .delete(`/api/parties/${CODE}/members/me`)
      .set("x-test-user", "user_c");

    expect(left.status).toBe(204);
    expect(db.partyMember.deleteMany).toHaveBeenCalledWith({
      where: { partyId: "party_1", userId: "user_b" },
    });
    expect(stranger.status).toBe(404);
    expect(db.party.delete).not.toHaveBeenCalled();
  });

  it("hands the party to the longest-standing player when the host leaves", async () => {
    // Sam joined before Rio, so Sam is next in line.
    db.party.findUnique.mockResolvedValue(
      party(member("user_a", "Max"), member("user_b", "Sam"), member("user_c", "Rio")),
    );

    const res = await request(app)
      .delete(`/api/parties/${CODE}/members/me`)
      .set("x-test-user", "user_a");

    expect(res.status).toBe(204);
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { hostId: "user_b" },
    });
    expect(db.partyMember.deleteMany).toHaveBeenCalledWith({
      where: { partyId: "party_1", userId: "user_a" },
    });
    expect(db.party.delete).not.toHaveBeenCalled();
  });

  it("ends the party when a host who is alone leaves", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max")));

    const res = await request(app)
      .delete(`/api/parties/${CODE}/members/me`)
      .set("x-test-user", "user_a");

    expect(res.status).toBe(204);
    expect(db.party.delete).toHaveBeenCalledWith({ where: { id: "party_1" } });
    expect(db.party.update).not.toHaveBeenCalled();
  });

  it("lets only the host rename the party, with the same name rules", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));
    const rename = (user: string, name: string) =>
      request(app).patch(`/api/parties/${CODE}`).set("x-test-user", user).send({ name });

    const byMember = await rename("user_b", "Hijacked");
    const tooLong = await rename("user_a", "x".repeat(41));
    const byHost = await rename("user_a", "  Saturday   night ");

    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("PARTY_NOT_HOST");
    expect(tooLong.status).toBe(400);
    expect(byHost.status).toBe(200);
    expect(byHost.body.data).toMatchObject({ name: "Saturday night", ignoreLimits: false });
    expect(db.party.update).toHaveBeenCalledTimes(1);
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { name: "Saturday night" },
    });
  });

  it("lets only the host set whether player limits are ignored, for the whole party", async () => {
    const current = party(member("user_a", "Max"), member("user_b", "Sam"));
    db.party.findUnique.mockResolvedValue(current);
    const set = (user: string, body: object) =>
      request(app).patch(`/api/parties/${CODE}`).set("x-test-user", user).send(body);

    const byMember = await set("user_b", { ignoreLimits: true });
    const notBoolean = await set("user_a", { ignoreLimits: "yes" });
    const nothing = await set("user_a", {});

    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("PARTY_NOT_HOST");
    expect(notBoolean.status).toBe(400);
    expect(nothing.status).toBe(400);
    expect(db.party.update).not.toHaveBeenCalled();

    const byHost = await set("user_a", { ignoreLimits: true });

    expect(byHost.status).toBe(200);
    // The name is left alone when only the setting is sent.
    expect(byHost.body.data).toMatchObject({ name: "Friday night", ignoreLimits: true });
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { ignoreLimits: true },
    });

    // The change gives the party a new version, so every open page picks it up.
    const before = await request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", "user_b");
    db.party.findUnique.mockResolvedValue({ ...current, ignoreLimits: true });
    const after = await request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", "user_b");

    expect(after.body.data.version).not.toBe(before.body.data.version);
    expect(after.body.data.version).toBe(byHost.body.data.version);
  });

  it("lets only the host remove a player, and never themselves", async () => {
    db.party.findUnique.mockResolvedValue(
      party(member("user_a", "Max"), member("user_b", "Sam"), member("user_c", "Rio")),
    );
    const remove = (user: string, memberId: string) =>
      request(app).delete(`/api/parties/${CODE}/members/${memberId}`).set("x-test-user", user);

    const byMember = await remove("user_b", "member_rio");
    const themselves = await remove("user_a", "member_max");
    const stranger = await remove("user_a", "member_nobody");

    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("PARTY_NOT_HOST");
    expect(themselves.status).toBe(409);
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe("PARTY_MEMBER_NOT_FOUND");
    expect(db.partyMember.deleteMany).not.toHaveBeenCalled();

    const byHost = await remove("user_a", "member_sam");

    expect(byHost.status).toBe(204);
    // The removal is recorded against the account, so the link no longer lets them back in.
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { removedUserIds: { push: "user_b" } },
    });
    expect(db.partyMember.deleteMany).toHaveBeenCalledWith({
      where: { id: "member_sam", partyId: "party_1" },
    });
  });

  it("stops a removed player from rejoining with the link", async () => {
    db.party.findUnique.mockResolvedValue({
      ...party(member("user_a", "Max")),
      removedUserIds: ["user_b"],
    });

    const invite = await request(app).get(`/api/parties/${CODE}/invite`).set("x-test-user", "user_b");
    const rejoin = await request(app)
      .post(`/api/parties/${CODE}/members`)
      .set("x-test-user", "user_b")
      .send({ displayName: "Sam again" });

    expect(invite.body.data).toMatchObject({ joined: false, removed: true });
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.code).toBe("PARTY_REMOVED");
    expect(db.partyMember.upsert).not.toHaveBeenCalled();
  });

  it("records the host's roll for everyone, after checking the game is really shared", async () => {
    const halo = game("game_1", "Halo Infinite", ["Multiplayer"]);
    const hades = game("game_3", "Hades", ["Single player"]);
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));
    const roll = (user: string, igdbId: unknown) =>
      request(app).post(`/api/parties/${CODE}/roll`).set("x-test-user", user).send({ igdbId });

    const byMember = await roll("user_b", 1);
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("PARTY_NOT_HOST");

    // Only Max owns it.
    db.userGame.findMany.mockResolvedValueOnce([owns("user_a", halo)]);
    const notShared = await roll("user_a", 1);
    // Both own it, but it cannot be played together.
    db.userGame.findMany.mockResolvedValueOnce([owns("user_a", hades), owns("user_b", hades)]);
    const singlePlayer = await roll("user_a", 3);

    for (const res of [notShared, singlePlayer]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PARTY_GAME_NOT_SHARED");
    }
    expect((await roll("user_a", "1")).status).toBe(400);
    expect(db.party.update).not.toHaveBeenCalled();

    db.userGame.findMany.mockResolvedValueOnce([owns("user_a", halo), owns("user_b", halo)]);
    const ok = await roll("user_a", 1);

    expect(ok.status).toBe(200);
    expect(ok.body.data.rolledIgdbId).toBe(1);
    expect(db.userGame.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: { in: ["user_a", "user_b"] }, game: { igdbId: 1 } },
      }),
    );
    expect(db.party.update).toHaveBeenCalledWith({
      where: { id: "party_1" },
      data: { rolledIgdbId: 1, rolledAt: expect.any(Date) },
    });
  });

  describe("nominations", () => {
    const halo = game("game_1", "Halo Infinite", ["Multiplayer"]);
    const doom = game("game_2", "Doom", ["Multiplayer"]);
    const apex = game("game_4", "Apex", ["Multiplayer"]);
    const hades = game("game_3", "Hades", ["Single player"]);
    const both = (owned: ReturnType<typeof game>) => [owns("user_a", owned), owns("user_b", owned)];
    const nominate = (user: string, igdbId: unknown) =>
      request(app).post(`/api/parties/${CODE}/nominations`).set("x-test-user", user).send({ igdbId });
    const roll = (igdbId: number, extra: object = {}) =>
      request(app).post(`/api/parties/${CODE}/roll`).set("x-test-user", "user_a").send({ igdbId, ...extra });
    const pair = () => party(member("user_a", "Max"), member("user_b", "Sam"));

    it("lets a member nominate a playable game, and only members", async () => {
      db.party.findUnique.mockResolvedValue(pair());
      db.userGame.findMany.mockResolvedValue(both(halo));

      const outsider = await nominate("user_z", 1);
      const ok = await nominate("user_b", 1);

      expect(outsider.status).toBe(403);
      expect(outsider.body.error.code).toBe("PARTY_NOT_JOINED");
      expect(ok.status).toBe(200);
      expect(ok.body.data.nominations).toEqual([{ igdbId: 1, memberId: "member_sam" }]);
      expect(db.partyNomination.upsert).toHaveBeenCalledTimes(1);
      expect(db.partyNomination.upsert.mock.calls[0][0].create).toEqual({
        partyId: "party_1",
        userId: "user_b",
        igdbId: 1,
      });
    });

    it("blocks a player the host removed", async () => {
      db.party.findUnique.mockResolvedValue({
        ...pair(),
        members: [member("user_a", "Max")],
        removedUserIds: ["user_b"],
      });

      const res = await nominate("user_b", 1);

      expect(res.status).toBe(403);
      expect(db.partyNomination.upsert).not.toHaveBeenCalled();
    });

    it("only accepts games in the playable pool", async () => {
      db.party.findUnique.mockResolvedValue(pair());
      // Only Max owns it, then both own a single player game.
      db.userGame.findMany.mockResolvedValueOnce([owns("user_a", halo)]);
      db.userGame.findMany.mockResolvedValueOnce(both(hades));
      const notShared = await nominate("user_a", 1);
      const singlePlayer = await nominate("user_a", 3);

      for (const res of [notShared, singlePlayer]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("PARTY_GAME_NOT_PLAYABLE");
      }
      expect((await nominate("user_a", "1")).status).toBe(400);
      expect(db.partyNomination.upsert).not.toHaveBeenCalled();
    });

    it("limits each member to two nominations, but lets a repeat through", async () => {
      db.party.findUnique.mockResolvedValue({
        ...pair(),
        nominations: [
          { userId: "user_a", igdbId: 1 },
          { userId: "user_a", igdbId: 2 },
        ],
      });
      db.userGame.findMany.mockResolvedValue(both(apex));

      const third = await nominate("user_a", 4);
      const repeat = await nominate("user_a", 1);
      const other = await nominate("user_b", 4);

      expect(third.status).toBe(409);
      expect(third.body.error.code).toBe("NOMINATION_LIMIT");
      expect(repeat.status).toBe(200);
      expect(other.status).toBe(200);
      // Only Sam's new nomination was written.
      expect(db.partyNomination.upsert).toHaveBeenCalledTimes(1);
    });

    it("lets a member remove only their own nomination", async () => {
      db.party.findUnique.mockResolvedValue({
        ...pair(),
        nominations: [
          { userId: "user_a", igdbId: 1 },
          { userId: "user_b", igdbId: 2 },
        ],
      });
      const remove = (user: string, igdbId: number) =>
        request(app).delete(`/api/parties/${CODE}/nominations/${igdbId}`).set("x-test-user", user);

      // Game 2 is Sam's, so Max asking to remove it deletes nothing of Sam's.
      const notTheirs = await remove("user_a", 2);

      expect(db.partyNomination.deleteMany).toHaveBeenCalledWith({
        where: { partyId: "party_1", userId: "user_a", igdbId: 2 },
      });
      expect(notTheirs.body.data.nominations).toHaveLength(2);

      const own = await remove("user_a", 1);

      expect(own.status).toBe(200);
      expect(own.body.data.nominations).toEqual([{ igdbId: 2, memberId: "member_sam" }]);
      expect((await remove("user_z", 1)).status).toBe(403);
    });

    it("shows nominations in the party and changes the version", async () => {
      db.party.findUnique.mockResolvedValue(pair());
      const before = await request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", "user_b");
      db.party.findUnique.mockResolvedValue({ ...pair(), nominations: [{ userId: "user_a", igdbId: 1 }] });
      const after = await request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", "user_b");

      expect(after.body.data.version).not.toBe(before.body.data.version);

      db.userGame.findMany.mockResolvedValue([...both(halo), ...both(hades)]);
      const detail = await request(app).get(`/api/parties/${CODE}`).set("x-test-user", "user_b");

      // Sam sees who nominated the game, by member ID and never by account ID.
      expect(detail.body.data.nominations).toEqual([{ igdbId: 1, memberId: "member_max" }]);
      expect(JSON.stringify(detail.body)).not.toContain("user_a");
    });

    it("rolls from the nominated games only, and clears them after the roll", async () => {
      db.party.findUnique.mockResolvedValue({
        ...pair(),
        nominations: [
          { userId: "user_a", igdbId: 1 },
          { userId: "user_b", igdbId: 2 },
        ],
      });
      db.userGame.findMany.mockImplementation(
        async ({ where }: { where: { game: { igdbId: number | { in: number[] } } } }) => {
          const wanted = where.game.igdbId;
          return [halo, doom, apex]
            .flatMap(both)
            .filter((entry) =>
              typeof wanted === "number"
                ? entry.game.igdbId === wanted
                : wanted.in.includes(entry.game.igdbId),
            );
        },
      );

      const outside = await roll(4);

      expect(outside.status).toBe(409);
      expect(outside.body.error.code).toBe("PARTY_GAME_NOT_NOMINATED");
      expect(db.party.update).not.toHaveBeenCalled();

      // The host can choose to roll from everything instead.
      expect((await roll(4, { fromAll: true })).status).toBe(200);

      db.partyNomination.deleteMany.mockClear();
      const nominated = await roll(2);

      expect(nominated.status).toBe(200);
      expect(nominated.body.data.rolledIgdbId).toBe(2);
      // The next round starts clean.
      expect(db.partyNomination.deleteMany).toHaveBeenCalledWith({ where: { partyId: "party_1" } });
    });

    it("rolls from everything when fewer than two games are nominated", async () => {
      db.party.findUnique.mockResolvedValue({ ...pair(), nominations: [{ userId: "user_a", igdbId: 1 }] });
      db.userGame.findMany.mockResolvedValue(both(apex));

      expect((await roll(4)).status).toBe(200);
    });

    it("drops a player's nominations when they leave or are removed", async () => {
      db.party.findUnique.mockResolvedValue(pair());

      const left = await request(app).delete(`/api/parties/${CODE}/members/me`).set("x-test-user", "user_b");

      expect(left.status).toBe(204);
      expect(db.partyNomination.deleteMany).toHaveBeenCalledWith({
        where: { partyId: "party_1", userId: "user_b" },
      });

      db.partyNomination.deleteMany.mockClear();
      await request(app).delete(`/api/parties/${CODE}/members/member_sam`).set("x-test-user", "user_a");

      expect(db.partyNomination.deleteMany).toHaveBeenCalledWith({
        where: { partyId: "party_1", userId: "user_b" },
      });
    });
  });

  it("gives members a version that changes when the party does", async () => {
    const two = party(member("user_a", "Max"), member("user_b", "Sam"));
    const check = async (current: object, user = "user_b") => {
      db.party.findUnique.mockResolvedValue(current);
      return request(app).get(`/api/parties/${CODE}/version`).set("x-test-user", user);
    };

    const before = await check(two);
    const same = await check(two, "user_a");
    const joined = await check(party(member("user_a", "Max"), member("user_b", "Sam"), member("user_c", "Rio")));
    const renamed = await check({ ...two, name: "Saturday night" });
    const rolled = await check({ ...two, rolledIgdbId: 1, rolledAt: new Date("2026-10-13T12:00:00Z") });
    const outsider = await check(two, "user_z");

    expect(before.status).toBe(200);
    // Every member gets the same version for the same party.
    expect(same.body.data.version).toBe(before.body.data.version);
    for (const changed of [joined, renamed, rolled]) {
      expect(changed.body.data.version).not.toBe(before.body.data.version);
    }
    expect(outsider.status).toBe(403);
    // Checking the version never reads anyone's library.
    expect(db.userGame.findMany).not.toHaveBeenCalled();
  });

  it("lets the host end the party for everyone, and nobody else", async () => {
    db.party.findUnique.mockResolvedValue(party(member("user_a", "Max"), member("user_b", "Sam")));

    const member2 = await request(app).delete(`/api/parties/${CODE}`).set("x-test-user", "user_b");

    expect(member2.status).toBe(403);
    expect(member2.body.error.code).toBe("PARTY_NOT_HOST");
    expect(db.party.delete).not.toHaveBeenCalled();

    const host = await request(app).delete(`/api/parties/${CODE}`).set("x-test-user", "user_a");

    expect(host.status).toBe(204);
    expect(db.party.delete).toHaveBeenCalledWith({ where: { id: "party_1" } });
  });
});

describe("GET /api/recommendations/options", () => {
  it("counts the authenticated user's games for each picker type", async () => {
    db.userGame.findMany.mockResolvedValue([hadesEntry]);

    const res = await request(app)
      .get("/api/recommendations/options")
      .set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(db.userGame.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_a" } }),
    );

    const counts = Object.fromEntries(
      res.body.data.genres.map((genre: { name: string; count: number }) => [genre.name, genre.count]),
    );
    expect(counts.RPG).toBe(1);
    expect(counts.Action).toBe(1);
    expect(counts.Racing).toBe(0);
    expect(res.body.data.genres).toHaveLength(11);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/recommendations/options");

    expect(res.status).toBe(401);
  });
});

describe("POST /api/recommendations", () => {
  const validBody = { availableTime: "ANY", genres: ["RPG"], gameMode: "SINGLE_PLAYER" };

  it("rejects invalid preferences with 400", async () => {
    const bodies = [
      {},
      { ...validBody, availableTime: "FOREVER" },
      { ...validBody, genres: ["Cooking"] },
      { ...validBody, genres: "RPG" },
      { ...validBody, gameMode: "SOLO" },
    ];

    for (const body of bodies) {
      const res = await request(app)
        .post("/api/recommendations")
        .set("x-test-user", "user_a")
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns EMPTY_LIBRARY when the user has no games", async () => {
    db.userGame.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/recommendations")
      .set("x-test-user", "user_a")
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "EMPTY_LIBRARY",
      message: "Add games to your library before requesting recommendations.",
    });
  });

  it("recommends only from the authenticated user's library", async () => {
    db.userGame.findMany.mockResolvedValue([hadesEntry]);

    const res = await request(app)
      .post("/api/recommendations")
      .set("x-test-user", "user_a")
      .send({ ...validBody, userId: "user_b" });

    expect(res.status).toBe(200);
    expect(db.userGame.findMany.mock.calls[0][0].where).toEqual({ userId: "user_a" });
    expect(res.body.data.recommendations).toEqual([
      expect.objectContaining({
        id: "entry_1",
        title: "Hades",
        reasons: ["Matches RPG", "Supports single-player"],
      }),
    ]);
  });
});
