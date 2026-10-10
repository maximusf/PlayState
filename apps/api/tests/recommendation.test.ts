import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({ prisma: {} }));

import type { LibraryEntry } from "../src/services/library.service";
import { rankLibrary } from "../src/services/recommendation.service";

function entry(
  title: string,
  genres: string[],
  gameModes: string[],
  themes: string[] = [],
  extra: Partial<Pick<LibraryEntry, "sessionLength" | "pickedFor">> & {
    timeToBeatHours?: number | null;
  } = {},
): LibraryEntry {
  return {
    id: `entry-${title}`,
    addedAt: "2026-10-08T00:00:00.000Z",
    sessionLength: extra.sessionLength ?? null,
    pickedFor: extra.pickedFor ?? [],
    game: {
      igdbId: title.length,
      title,
      coverUrl: null,
      genres,
      themes,
      gameModes,
      releaseDate: null,
      timeToBeatHours: extra.timeToBeatHours ?? null,
    },
  };
}

const library = [
  entry("Hades", ["Role-playing (RPG)", "Hack and slash/Beat 'em up"], ["Single player"], ["Action"]),
  entry("Against the Storm", ["Strategy", "Simulator"], ["Single player"]),
  entry("League of Legends", ["MOBA", "Strategy"], ["Multiplayer"]),
  entry("Stardew Valley", ["Simulator", "Role-playing (RPG)"], ["Single player", "Co-operative"]),
  entry("Minecraft", ["Simulator", "Adventure"], ["Single player", "Multiplayer"], ["Sandbox"]),
];

describe("rankLibrary", () => {
  it("ranks a strategy single-player game first and drops mismatches", () => {
    const results = rankLibrary(library, {
      availableTime: "ANY",
      genres: ["Strategy"],
      gameMode: "SINGLE_PLAYER",
    });

    expect(results.map((game) => game.title)).toEqual(["Against the Storm"]);
    expect(results[0].reasons).toEqual(["Matches Strategy", "Supports single-player"]);
  });

  it("ranks a direct genre match above a related one", () => {
    const results = rankLibrary(library, {
      availableTime: "ANY",
      genres: ["Sandbox"],
      gameMode: "EITHER",
    });

    expect(results[0].title).toBe("Minecraft");
    expect(results[0].reasons).toContain("Matches Sandbox");
    expect(results.slice(1).every((game) => game.reasons.includes("Related to Sandbox"))).toBe(
      true,
    );
  });

  it("returns at most three games", () => {
    const results = rankLibrary(library, {
      availableTime: "ANY",
      genres: [],
      gameMode: "EITHER",
    });

    expect(results).toHaveLength(3);
  });

  describe("session length", () => {
    const short = { availableTime: "UNDER_30", genres: [], gameMode: "EITHER" } as const;
    const reasonsFor = (games: LibraryEntry[], input: Parameters<typeof rankLibrary>[1]) =>
      rankLibrary(games, input)[0].reasons;

    it("trusts the player's tag over the genre guess", () => {
      // An RPG would normally count as a long-session game.
      const tagged = entry("Hades", ["Role-playing (RPG)"], [], [], { sessionLength: "SHORT" });

      expect(reasonsFor([tagged], { ...short, genres: [] })).toEqual([
        "You tagged this for short sessions",
      ]);
      expect(
        reasonsFor([tagged], { availableTime: "TWO_PLUS_HOURS", genres: [], gameMode: "EITHER" }),
      ).toEqual(["From your library"]);
    });

    it("ranks a tagged game above a genre guess", () => {
      const tagged = entry("Tagged", ["Role-playing (RPG)"], [], [], { sessionLength: "SHORT" });
      const guessed = entry("Guessed", ["Puzzle"], []);

      const results = rankLibrary([guessed, tagged], { ...short, genres: [] });

      expect(results[0].title).toBe("Tagged");
    });

    it("learns from earlier picks made with similar time", () => {
      const picked = entry("Adventure Game", ["Adventure"], [], [], {
        pickedFor: ["THIRTY_TO_SIXTY"],
      });

      expect(reasonsFor([picked], { ...short, genres: [] })).toEqual([
        "You picked this before with similar time",
      ]);
    });

    it("counts a shooter as short only when it has multiplayer", () => {
      const campaign = entry("Campaign", ["Shooter"], ["Single player"]);
      const online = entry("Online", ["Shooter"], ["Multiplayer"]);

      expect(reasonsFor([campaign], { ...short, genres: [] })).toEqual(["From your library"]);
      expect(reasonsFor([online], { ...short, genres: [] })).toEqual(["Suits a shorter session"]);
    });

    it("falls back to the game's overall length when genres say nothing", () => {
      const brief = entry("Brief", ["Indie"], [], [], { timeToBeatHours: 3 });
      const epic = entry("Epic", ["Indie"], [], [], { timeToBeatHours: 80 });

      expect(reasonsFor([brief], { ...short, genres: [] })).toEqual(["A short game overall"]);
      expect(
        reasonsFor([epic], { availableTime: "TWO_PLUS_HOURS", genres: [], gameMode: "EITHER" }),
      ).toEqual(["A long game overall"]);
    });
  });

  it("skips games that were already shown", () => {
    const first = rankLibrary(library, { availableTime: "ANY", genres: [], gameMode: "EITHER" });
    const second = rankLibrary(library, {
      availableTime: "ANY",
      genres: [],
      gameMode: "EITHER",
      exclude: first.map((game) => game.id),
    });

    expect(first).toHaveLength(3);
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((game) => first.some((shown) => shown.id === game.id))).toBe(false);
  });

  it("excludes games that do not support the requested mode", () => {
    const results = rankLibrary(library, {
      availableTime: "ANY",
      genres: [],
      gameMode: "MULTIPLAYER",
    });

    expect(results.map((game) => game.title).sort()).toEqual([
      "League of Legends",
      "Minecraft",
      "Stardew Valley",
    ]);
  });

  it("keeps games with no mode data instead of rejecting them", () => {
    const results = rankLibrary([entry("Mystery Game", ["Puzzle"], [])], {
      availableTime: "ANY",
      genres: ["Puzzle"],
      gameMode: "SINGLE_PLAYER",
    });

    expect(results).toHaveLength(1);
  });

  it("returns nothing when no game matches the selected types", () => {
    const results = rankLibrary(library, {
      availableTime: "ANY",
      genres: ["Racing"],
      gameMode: "EITHER",
    });

    expect(results).toEqual([]);
  });

  it("uses time as a bonus, never as a filter", () => {
    const results = rankLibrary(library, {
      availableTime: "UNDER_30",
      genres: ["RPG"],
      gameMode: "EITHER",
    });

    expect(results.map((game) => game.title).sort()).toEqual(["Hades", "Stardew Valley"]);
  });

  it("orders tied games using the supplied random source", () => {
    const tied = [entry("A", ["Puzzle"], []), entry("B", ["Puzzle"], [])];
    const input = { availableTime: "ANY", genres: ["Puzzle"], gameMode: "EITHER" } as const;

    const ascending = [0.1, 0.9];
    const descending = [0.9, 0.1];

    expect(rankLibrary(tied, input, () => ascending.shift()!).map((g) => g.title)).toEqual([
      "A",
      "B",
    ]);
    expect(rankLibrary(tied, input, () => descending.shift()!).map((g) => g.title)).toEqual([
      "B",
      "A",
    ]);
  });
});
