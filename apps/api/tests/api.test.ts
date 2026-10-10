import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Stand-in for Clerk: the "session" is whatever user ID the test header carries.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: (req: Request) => ({ userId: req.headers["x-test-user"] ?? null }),
}));

const db = vi.hoisted(() => ({
  userGame: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  game: { upsert: vi.fn() },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

import app from "../src/app";
import { Prisma } from "../src/generated/prisma/client";
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
};

const hadesEntry = {
  id: "entry_1",
  userId: "user_a",
  gameId: "game_1",
  createdAt: new Date("2026-10-08"),
  game: hadesRow,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenCache();
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/health", () => {
  it("returns ok without authentication", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
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
      const res = await request(app).get(path);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
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
        },
        { id: 2, name: "No Metadata" },
      ]),
    );

    const res = await request(app).get("/api/catalog/search?q=hades");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        igdbId: 113112,
        title: "Hades",
        coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
        genres: ["Role-playing (RPG)"],
        releaseYear: 2020,
      },
      { igdbId: 2, title: "No Metadata", coverUrl: null, genres: [], releaseYear: null },
    ]);
  });

  it("escapes quotes in the search term", async () => {
    mockIgdb(() => json([]));

    await request(app).get("/api/catalog/search").query({ q: 'ha"des' });

    const igdbCall = fetchMock.mock.calls.find(([url]) => String(url).includes("igdb.com"));
    expect(igdbCall?.[1].body).toContain('search "ha\\"des";');
  });

  it("returns 502 when IGDB fails, without leaking upstream details", async () => {
    mockIgdb(() => json({ message: "upstream secret detail" }, 500));

    const res = await request(app).get("/api/catalog/search?q=hades");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "IGDB_UNAVAILABLE", message: "The game catalog is unavailable right now." },
    });
  });

  it("returns 502 when the network request throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const res = await request(app).get("/api/catalog/search?q=hades");

    expect(res.status).toBe(502);
  });

  it("refreshes the token once when IGDB rejects it", async () => {
    let igdbCalls = 0;
    mockIgdb(() => (++igdbCalls === 1 ? json({}, 401) : json([])));

    const res = await request(app).get("/api/catalog/search?q=hades");

    expect(res.status).toBe(200);
    expect(igdbCalls).toBe(2);
  });
});

describe("GET /api/catalog/games/:igdbId", () => {
  it("rejects a non-numeric id with 400", async () => {
    const res = await request(app).get("/api/catalog/games/abc");

    expect(res.status).toBe(400);
  });

  it("returns 404 when IGDB has no such game", async () => {
    mockIgdb(() => json([]));

    const res = await request(app).get("/api/catalog/games/999");

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
