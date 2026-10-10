import { AppError } from "../lib/errors";
import type { RecommendationInput } from "../schemas/recommendation.schema";
import { listLibrary, type LibraryEntry } from "./library.service";

const MAX_RECOMMENDATIONS = 3;

type Preference = RecommendationInput["genres"][number];

// Maps each picker option to IGDB genre and theme names.
// "primary" names are a direct match (+2), "related" names are a looser match (+1).
const PREFERENCE_TAGS: Record<Preference, { primary: string[]; related: string[] }> = {
  Action: {
    primary: ["Action", "Hack and slash/Beat 'em up", "Fighting"],
    related: ["Shooter", "Platform", "Arcade"],
  },
  Adventure: {
    primary: ["Adventure", "Point-and-click"],
    related: ["Open world", "Visual Novel", "Mystery"],
  },
  RPG: {
    primary: ["Role-playing (RPG)"],
    related: ["Fantasy", "Open world"],
  },
  Strategy: {
    primary: [
      "Strategy",
      "Real Time Strategy (RTS)",
      "Turn-based strategy (TBS)",
      "Tactical",
      "MOBA",
    ],
    related: ["4X", "Card & Board Game", "Warfare"],
  },
  Simulation: {
    primary: ["Simulator"],
    related: ["Business", "Sandbox"],
  },
  Shooter: {
    primary: ["Shooter"],
    related: ["Warfare"],
  },
  Puzzle: {
    primary: ["Puzzle"],
    related: ["Point-and-click", "Card & Board Game", "Quiz/Trivia"],
  },
  Platformer: {
    primary: ["Platform"],
    related: ["Arcade"],
  },
  Racing: {
    primary: ["Racing"],
    related: [],
  },
  Sports: {
    primary: ["Sport"],
    related: [],
  },
  Sandbox: {
    primary: ["Sandbox"],
    related: ["Open world", "Survival", "Simulator"],
  },
};

const MULTIPLAYER_MODES = [
  "Multiplayer",
  "Co-operative",
  "Split screen",
  "Massively Multiplayer Online (MMO)",
  "Battle Royale",
];

// IGDB has no session-length data, so time is a rough genre-based hint.
// It can add a point but never removes a game.
const SHORT_SESSION_TAGS = [
  "Puzzle",
  "Arcade",
  "Racing",
  "Sport",
  "Fighting",
  "Platform",
  "Card & Board Game",
  "Music",
  "Pinball",
  "Quiz/Trivia",
  "Shooter",
  "MOBA",
];
const LONG_SESSION_TAGS = [
  "Role-playing (RPG)",
  "Strategy",
  "Real Time Strategy (RTS)",
  "Turn-based strategy (TBS)",
  "Simulator",
  "Adventure",
  "4X",
  "Open world",
];

export type Recommendation = {
  id: string;
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  gameModes: string[];
  reasons: string[];
};

type Scored = { entry: LibraryEntry; score: number; reasons: string[] };

function hasAny(tags: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => tags.includes(candidate));
}

// Returns null when the game should not be suggested at all.
function scoreEntry(entry: LibraryEntry, input: RecommendationInput): Scored | null {
  const { game } = entry;
  const tags = [...game.genres, ...game.themes];
  const reasons: string[] = [];
  let score = 0;

  for (const preference of input.genres) {
    const { primary, related } = PREFERENCE_TAGS[preference];

    if (hasAny(tags, primary)) {
      score += 2;
      reasons.push(`Matches ${preference}`);
    } else if (hasAny(tags, related)) {
      score += 1;
      reasons.push(`Related to ${preference}`);
    }
  }

  // When the user asked for specific types, a game must match at least one.
  if (input.genres.length > 0 && score === 0) return null;

  if (input.gameMode !== "EITHER") {
    const wantsSingle = input.gameMode === "SINGLE_PLAYER";
    const matches = wantsSingle
      ? game.gameModes.includes("Single player")
      : hasAny(game.gameModes, MULTIPLAYER_MODES);

    if (matches) {
      score += 1;
      reasons.push(wantsSingle ? "Supports single-player" : "Supports multiplayer");
    } else if (game.gameModes.length > 0) {
      // The game lists its modes and the requested one is not among them.
      return null;
    }
  }

  if (
    (input.availableTime === "UNDER_30" || input.availableTime === "THIRTY_TO_SIXTY") &&
    hasAny(tags, SHORT_SESSION_TAGS)
  ) {
    score += 1;
    reasons.push("Suits a shorter session");
  } else if (input.availableTime === "TWO_PLUS_HOURS" && hasAny(tags, LONG_SESSION_TAGS)) {
    score += 1;
    reasons.push("Suits a longer session");
  }

  if (reasons.length === 0) reasons.push("From your library");

  return { entry, score, reasons };
}

// Pure scoring step, kept separate from data access so it is easy to test.
export function rankLibrary(
  library: LibraryEntry[],
  input: RecommendationInput,
  random: () => number = Math.random,
): Recommendation[] {
  return library
    .flatMap((entry) => {
      const scored = scoreEntry(entry, input);
      // The random tiebreak shuffles games that share a score.
      return scored ? [{ ...scored, tiebreak: random() }] : [];
    })
    .sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak)
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ entry, reasons }) => ({
      id: entry.id,
      igdbId: entry.game.igdbId,
      title: entry.game.title,
      coverUrl: entry.game.coverUrl,
      genres: entry.game.genres,
      gameModes: entry.game.gameModes,
      reasons,
    }));
}

export async function recommendGames(
  userId: string,
  input: RecommendationInput,
): Promise<Recommendation[]> {
  // Only the authenticated user's library is ever considered.
  const library = await listLibrary(userId);

  if (library.length === 0) {
    throw new AppError(
      400,
      "EMPTY_LIBRARY",
      "Add games to your library before requesting recommendations.",
    );
  }

  return rankLibrary(library, input);
}
