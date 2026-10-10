import { AppError } from "../lib/errors";
import { GAME_PREFERENCES, type RecommendationInput } from "../schemas/recommendation.schema";
import { listLibrary, type LibraryEntry } from "./library.service";
import { hasAny, MULTIPLAYER_MODES, PREFERENCE_TAGS } from "./preferences";

const MAX_RECOMMENDATIONS = 3;

// IGDB has no session-length data, so these genre lists are only a fallback guess.
// See sessionHint for the order of evidence.
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
  "MOBA",
  "Hack and slash/Beat 'em up",
];
const LONG_SESSION_TAGS = [
  "Role-playing (RPG)",
  "Strategy",
  "Real Time Strategy (RTS)",
  "Turn-based strategy (TBS)",
  "Simulator",
  "Adventure",
  "4X (explore, expand, exploit, and exterminate)",
  "Open world",
  "Tactical",
  "Visual Novel",
  "Survival",
];

type SessionBucket = "SHORT" | "MEDIUM" | "LONG";

// Which session length each time answer stands for. "ANY" has none.
const SESSION_BUCKETS: Partial<Record<string, SessionBucket>> = {
  UNDER_30: "SHORT",
  THIRTY_TO_SIXTY: "SHORT",
  ONE_TO_TWO_HOURS: "MEDIUM",
  TWO_PLUS_HOURS: "LONG",
};

const BUCKET_WORDS: Record<SessionBucket, string> = {
  SHORT: "short",
  MEDIUM: "medium",
  LONG: "long",
};

// A whole game this short can be played in bursts, and one this long rewards a long sitting.
const SHORT_GAME_HOURS = 6;
const LONG_GAME_HOURS = 25;

// Decides whether a game suits the requested session length, using the best evidence available:
// the player's own tag, then their past picks, then genres, then the game's overall length.
function sessionHint(
  entry: LibraryEntry,
  bucket: SessionBucket,
): { points: number; reason: string } | null {
  const { game } = entry;

  // 1. The player's tag is the only real measurement, so it overrides every guess.
  if (entry.sessionLength) {
    return entry.sessionLength === bucket
      ? { points: 2, reason: `You tagged this for ${BUCKET_WORDS[bucket]} sessions` }
      : null;
  }

  // 2. They chose this game before when they had a similar amount of time.
  if (entry.pickedFor.some((answer) => SESSION_BUCKETS[answer] === bucket)) {
    return { points: 1, reason: "You picked this before with similar time" };
  }

  // 3. Genres and themes. A shooter only counts as short when it has multiplayer matches.
  const tags = [...game.genres, ...game.themes];
  const short =
    hasAny(tags, SHORT_SESSION_TAGS) ||
    (tags.includes("Shooter") && hasAny(game.gameModes, MULTIPLAYER_MODES));
  const long = hasAny(tags, LONG_SESSION_TAGS);

  if (bucket === "SHORT" && short) return { points: 1, reason: "Suits a shorter session" };
  if (bucket === "LONG" && long) return { points: 1, reason: "Suits a longer session" };
  if (bucket === "MEDIUM" && short && long) return { points: 1, reason: "Works at any length" };

  // 4. With no genre signal, fall back to how long the whole game is.
  if (!short && !long && game.timeToBeatHours !== null) {
    if (bucket === "SHORT" && game.timeToBeatHours <= SHORT_GAME_HOURS) {
      return { points: 1, reason: "A short game overall" };
    }
    if (bucket === "LONG" && game.timeToBeatHours >= LONG_GAME_HOURS) {
      return { points: 1, reason: "A long game overall" };
    }
  }

  return null;
}

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

  // Time can add points but never removes a game.
  const bucket = SESSION_BUCKETS[input.availableTime];
  const hint = bucket ? sessionHint(entry, bucket) : null;

  if (hint) {
    score += hint.points;
    reasons.push(hint.reason);
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
  const excluded = new Set(input.exclude ?? []);

  return library
    .filter((entry) => !excluded.has(entry.id))
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

export type PickerOptions = { genres: { name: string; count: number }[] };

// How many of the user's games each picker type can surface, so the picker
// can leave out types that would return nothing.
export async function getPickerOptions(userId: string): Promise<PickerOptions> {
  const library = await listLibrary(userId);

  return {
    genres: GAME_PREFERENCES.map((name) => {
      const { primary, related } = PREFERENCE_TAGS[name];

      return {
        name,
        count: library.filter(({ game }) => {
          const tags = [...game.genres, ...game.themes];
          return hasAny(tags, primary) || hasAny(tags, related);
        }).length,
      };
    }),
  };
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
