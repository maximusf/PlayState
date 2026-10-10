import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({ prisma: {} }));

import type { LibraryEntry } from "../src/services/library.service";
import { rankLibrary } from "../src/services/recommendation.service";

function entry(
  title: string,
  genres: string[],
  gameModes: string[],
  themes: string[] = [],
): LibraryEntry {
  return {
    id: `entry-${title}`,
    addedAt: "2026-10-08T00:00:00.000Z",
    game: {
      igdbId: title.length,
      title,
      coverUrl: null,
      genres,
      themes,
      gameModes,
      releaseDate: null,
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
