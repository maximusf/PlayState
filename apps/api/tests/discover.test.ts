import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Stand-in for Clerk: the "session" is whatever user ID the test header carries.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuth: (req: Request) => ({ userId: req.headers["x-test-user"] ?? null }),
}));
vi.mock("@clerk/express/webhooks", () => ({ verifyWebhook: vi.fn() }));

const db = vi.hoisted(() => ({ userGame: { findMany: vi.fn() } }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));

// IGDB is replaced, so no test sends a real request.
const getDiscoveryPool = vi.hoisted(() => vi.fn());
vi.mock("../src/services/igdb.service", () => ({ getDiscoveryPool }));

import app from "../src/app";
import { resetRateLimits } from "../src/middleware/rate-limit.middleware";
import type { DiscoverCandidate } from "../src/services/igdb.service";
import {
  buildProfile,
  isMature,
  pickSeeds,
  rankCandidates,
} from "../src/services/discover.service";
import type { LibraryEntry } from "../src/services/library.service";

function candidate(overrides: Partial<DiscoverCandidate> & { igdbId: number }): DiscoverCandidate {
  return {
    title: `Game ${overrides.igdbId}`,
    coverUrl: null,
    genres: ["Strategy"],
    themes: [],
    themeIds: [],
    gameModes: ["Single player"],
    keywords: [],
    releaseYear: 2021,
    rating: 80,
    ratingCount: 40,
    onSteam: true,
    ageRatings: [],
    similarToIgdbIds: [],
    ...overrides,
  };
}

function entry(igdbId: number, title: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: `entry-${igdbId}`,
    addedAt: "2026-10-08T00:00:00.000Z",
    sessionLength: null,
    game: {
      igdbId,
      title,
      coverUrl: null,
      genres: ["Strategy"],
      themes: ["Fantasy"],
      gameModes: ["Single player"],
      releaseDate: null,
      timeToBeatHours: null,
    },
    ...extra,
  };
}

const library = [entry(1, "Against the Storm"), entry(2, "Frostpunk")];
const profile = buildProfile(library, ["City builder"]);
const owned = new Set([1, 2]);

describe("isMature", () => {
  it("flags the Erotic theme by ID or by name", () => {
    expect(isMature(candidate({ igdbId: 10, themeIds: [42] }))).toBe(true);
    expect(isMature(candidate({ igdbId: 11, themes: ["Erotic"] }))).toBe(true);
  });

  it("flags ESRB Adults Only", () => {
    expect(isMature(candidate({ igdbId: 12, ageRatings: [{ category: 7, descriptions: [] }] }))).toBe(
      true,
    );
  });

  it("flags Mature and PEGI 18 only when the descriptors are sexual", () => {
    const violent = [{ category: 12, descriptions: ["Blood and Gore", "Intense Violence"] }];
    const sexual = [{ category: 12, descriptions: ["Sexual Content", "Nudity"] }];

    expect(isMature(candidate({ igdbId: 13, ageRatings: violent }))).toBe(false);
    expect(isMature(candidate({ igdbId: 14, ageRatings: sexual }))).toBe(true);
  });

  it("flags the descriptors IGDB really sends for ESRB Mature and PEGI 18", () => {
    const esrb = [{ category: 6, descriptions: ["Suggestive Themes", "Mature Sexual Themes"] }];
    const pegi = [{ category: 12, descriptions: ["Sex"] }];
    const esrbViolent = [{ category: 6, descriptions: ["Blood and Gore"] }];

    expect(isMature(candidate({ igdbId: 20, ageRatings: esrb }))).toBe(true);
    expect(isMature(candidate({ igdbId: 21, ageRatings: pegi }))).toBe(true);
    expect(isMature(candidate({ igdbId: 22, ageRatings: esrbViolent }))).toBe(false);
  });

  it("flags sexual keywords and titles, but not words that merely contain them", () => {
    expect(isMature(candidate({ igdbId: 15, keywords: ["hentai"] }))).toBe(true);
    expect(isMature(candidate({ igdbId: 16, title: "Hentai Puzzle" }))).toBe(true);
    expect(isMature(candidate({ igdbId: 17, title: "Essex County", keywords: ["sussex"] }))).toBe(
      false,
    );
  });

  it("leaves an ordinary game alone", () => {
    expect(isMature(candidate({ igdbId: 18 }))).toBe(false);
  });
});

describe("rankCandidates", () => {
  it("never suggests a game that is already in the library", () => {
    const result = rankCandidates(
      [candidate({ igdbId: 1 }), candidate({ igdbId: 2 }), candidate({ igdbId: 3 })],
      profile,
      owned,
      false,
    );

    expect(result.map((game) => game.igdbId)).toEqual([3]);
  });

  it("hides mature games by default and shows them when allowed", () => {
    const candidates = [candidate({ igdbId: 3 }), candidate({ igdbId: 4, themeIds: [42] })];

    expect(rankCandidates(candidates, profile, owned, false).map((game) => game.igdbId)).toEqual([
      3,
    ]);
    expect(
      rankCandidates(candidates, profile, owned, true)
        .map((game) => game.igdbId)
        .sort(),
    ).toEqual([3, 4]);
  });

  it("only suggests games available on Steam", () => {
    const result = rankCandidates([candidate({ igdbId: 3, onSteam: false })], profile, owned, true);

    expect(result).toEqual([]);
  });

  it("drops games that are poorly rated, barely rated or famous", () => {
    const result = rankCandidates(
      [
        candidate({ igdbId: 3, rating: 50 }),
        candidate({ igdbId: 4, ratingCount: 1 }),
        candidate({ igdbId: 5, ratingCount: 9000 }),
        candidate({ igdbId: 6, rating: null }),
      ],
      profile,
      owned,
      false,
    );

    expect(result).toEqual([]);
  });

  it("drops games that share nothing with the library", () => {
    const result = rankCandidates(
      [candidate({ igdbId: 3, genres: ["Racing"], gameModes: ["Multiplayer"] })],
      profile,
      owned,
      false,
    );

    expect(result).toEqual([]);
  });

  it("ranks a similar game first and says why", () => {
    const result = rankCandidates(
      [candidate({ igdbId: 3 }), candidate({ igdbId: 4, similarToIgdbIds: [2] })],
      profile,
      owned,
      false,
    );

    expect(result[0].igdbId).toBe(4);
    expect(result[0].reason).toBe("Because you play Frostpunk");
    expect(result[1].reason).toContain("Strategy");
  });

  it("favours a lesser-known game over a popular one with the same rating", () => {
    const result = rankCandidates(
      [candidate({ igdbId: 3, ratingCount: 1500 }), candidate({ igdbId: 4, ratingCount: 30 })],
      profile,
      owned,
      false,
    );

    expect(result.map((game) => game.igdbId)).toEqual([4, 3]);
  });
});

describe("pickSeeds and buildProfile", () => {
  it("seeds from tagged games first, then the newest", () => {
    const games = [
      entry(1, "Old", { addedAt: "2026-01-01T00:00:00.000Z" }),
      entry(2, "New", { addedAt: "2026-10-01T00:00:00.000Z" }),
      entry(3, "Tagged", { addedAt: "2026-02-01T00:00:00.000Z", sessionLength: "LONG" }),
    ];

    expect(pickSeeds(games).map((seed) => seed.game.title)).toEqual(["Tagged", "New", "Old"]);
  });

  it("ignores the Erotic theme when describing taste", () => {
    const games = [entry(1, "A"), entry(2, "B")];
    games[0].game.themes = ["Erotic"];
    games[1].game.themes = ["Erotic"];

    expect(buildProfile(games, []).themes).not.toContain("Erotic");
  });
});

describe("GET /api/discover", () => {
  const libraryRow = (igdbId: number, title: string) => ({
    id: `entry-${igdbId}`,
    createdAt: new Date("2026-10-08"),
    sessionLength: null,
    game: {
      igdbId,
      title,
      coverUrl: null,
      genres: ["Strategy"],
      themes: ["Fantasy"],
      gameModes: ["Single player"],
      releaseDate: null,
      timeToBeatHours: null,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
  });

  it("requires sign-in", async () => {
    const res = await request(app).get("/api/discover");

    expect(res.status).toBe(401);
    expect(getDiscoveryPool).not.toHaveBeenCalled();
  });

  it("returns an empty list for an empty library without asking IGDB", async () => {
    db.userGame.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/discover").set("x-test-user", "user_a");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { games: [], libraryCount: 0 } });
    expect(getDiscoveryPool).not.toHaveBeenCalled();
  });

  it("hides mature games unless mature=true is sent explicitly", async () => {
    db.userGame.findMany.mockResolvedValue([libraryRow(1, "Against the Storm")]);
    getDiscoveryPool.mockResolvedValue({
      candidates: [
        candidate({ igdbId: 1 }),
        candidate({ igdbId: 3 }),
        candidate({ igdbId: 4, themeIds: [42] }),
      ],
      seedKeywords: [],
    });

    const hidden = await request(app).get("/api/discover").set("x-test-user", "user_a");
    expect(hidden.body.data.games.map((game: { igdbId: number }) => game.igdbId)).toEqual([3]);
    expect(hidden.body.data.libraryCount).toBe(1);

    // Only the exact word "true" counts. Other truthy-looking values stay hidden.
    const loose = await request(app).get("/api/discover?mature=1").set("x-test-user", "user_a");
    expect(loose.body.data.games.map((game: { igdbId: number }) => game.igdbId)).toEqual([3]);

    const shown = await request(app).get("/api/discover?mature=true").set("x-test-user", "user_a");
    expect(
      shown.body.data.games.map((game: { igdbId: number }) => game.igdbId).sort(),
    ).toEqual([3, 4]);
  });
});
