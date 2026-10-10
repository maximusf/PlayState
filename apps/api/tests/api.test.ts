import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Stand-in for Clerk: the "session" is whatever user ID the test header carries.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: (req: Request) => ({ userId: req.headers["x-test-user"] ?? null }),
}));

const db = vi.hoisted(() => ({
  userGame: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  game: { upsert: vi.fn(), update: vi.fn() },
  pick: { create: vi.fn() },
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
  timeToBeatHours: null as number | null,
};

const hadesEntry = {
  id: "entry_1",
  userId: "user_a",
  gameId: "game_1",
  createdAt: new Date("2026-10-08"),
  sessionLength: null as string | null,
  picks: [] as { availableTime: string }[],
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
          total_rating: 92.6,
          total_rating_count: 2100,
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

    await request(app).get("/api/catalog/search").query({ q: 'ha"des' });

    const igdbCall = fetchMock.mock.calls.find(([url]) => String(url).includes("igdb.com"));
    expect(igdbCall?.[1].body).toContain('search "ha\\"des";');
  });

  it("asks IGDB to leave out DLC and special editions", async () => {
    mockIgdb(() => json([]));

    await request(app).get("/api/catalog/search").query({ q: "hades" });

    const igdbCall = fetchMock.mock.calls.find(([url]) => String(url).includes("igdb.com"));
    expect(igdbCall?.[1].body).toContain("game_type = (0,4,8,9,10,11)");
    expect(igdbCall?.[1].body).toContain("version_parent = null");
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

describe("POST /api/library/:id/picks", () => {
  it("records a pick against the authenticated user", async () => {
    db.userGame.findFirst.mockResolvedValue(hadesEntry);

    const res = await request(app)
      .post("/api/library/entry_1/picks")
      .set("x-test-user", "user_a")
      .send({ availableTime: "UNDER_30", userId: "someone_else" });

    expect(res.status).toBe(201);
    expect(db.pick.create).toHaveBeenCalledWith({
      data: { userId: "user_a", userGameId: "entry_1", availableTime: "UNDER_30" },
    });
  });

  it("does not record a pick for another user's entry", async () => {
    db.userGame.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/library/entry_1/picks")
      .set("x-test-user", "user_b")
      .send({ availableTime: "UNDER_30" });

    expect(res.status).toBe(404);
    expect(db.pick.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown time answer with 400", async () => {
    const res = await request(app)
      .post("/api/library/entry_1/picks")
      .set("x-test-user", "user_a")
      .send({ availableTime: "ALL_DAY" });

    expect(res.status).toBe(400);
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
