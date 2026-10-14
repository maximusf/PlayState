import { getDiscoveryPool, type DiscoverCandidate } from "./igdb.service";
import { listLibrary, type LibraryEntry } from "./library.service";

// How many library games seed the search, and how many tags of each kind describe the taste.
const SEED_GAMES = 8;
const TOP_GENRES = 3;
const TOP_THEMES = 4;
const TOP_KEYWORDS = 8;
const MAX_RESULTS = 36;

// A score from a handful of ratings is not reliable, and a game rated by thousands is no secret.
const MIN_RATING = 65;
const MIN_RATINGS = 3;
const MAX_RATINGS = 2000;

// IGDB's theme ID for "Erotic".
const EROTIC_THEME_ID = 42;
// IGDB's age rating category IDs, from its age_rating_categories endpoint.
const ESRB_MATURE = 6;
const ESRB_ADULTS_ONLY = 7;
const PEGI_18 = 12;

// A second line of defence for games IGDB has not tagged. Whole words only, so "Essex" is fine.
const SEXUAL_WORDS =
  /\b(hentai|erotic|eroge|porn|porno|pornographic|nsfw|ecchi|lewd|nudity|nude|sex|sexual|sexy|adult|uncensored|18\+)\b/i;
// Descriptions on an age rating that mean sexual content, as opposed to violence or language.
const SEXUAL_DESCRIPTIONS = /\b(sex|sexual|nudity|nude|erotic|strong sexual)/i;

export type DiscoverGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
  rating: number | null;
  ratingCount: number;
  // A plain sentence on why this game was suggested.
  reason: string;
};

export type DiscoverResult = {
  games: DiscoverGame[];
  // How many games the player has, so the page can tell an empty library from no matches.
  libraryCount: number;
};

export type TasteProfile = {
  genres: string[];
  themes: string[];
  gameModes: string[];
  keywords: string[];
  // Titles of the games the search started from, by IGDB ID.
  seedTitles: Map<number, string>;
};

// Whether a game may contain sexual content. Any one signal is enough.
export function isMature(game: DiscoverCandidate): boolean {
  if (game.themeIds.includes(EROTIC_THEME_ID)) return true;
  if (game.themes.some((theme) => theme.toLowerCase() === "erotic")) return true;

  const rated = game.ageRatings.some(
    (rating) =>
      rating.category === ESRB_ADULTS_ONLY ||
      ((rating.category === ESRB_MATURE || rating.category === PEGI_18) &&
        rating.descriptions.some((description) => SEXUAL_DESCRIPTIONS.test(description))),
  );
  if (rated) return true;

  return [game.title, ...game.keywords].some((text) => SEXUAL_WORDS.test(text));
}

// Counts how often each value appears, most common first.
function topValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

// The games the player most likely plays: the ones they tagged with a session length,
// then the ones they added most recently.
export function pickSeeds(library: LibraryEntry[]): LibraryEntry[] {
  return [...library]
    .sort(
      (a, b) =>
        Number(b.sessionLength !== null) - Number(a.sessionLength !== null) ||
        b.addedAt.localeCompare(a.addedAt),
    )
    .slice(0, SEED_GAMES);
}

export function buildProfile(library: LibraryEntry[], seedKeywords: string[]): TasteProfile {
  const seeds = pickSeeds(library);

  return {
    // Every game counts towards the taste, not only the seeds.
    genres: topValues(library.flatMap(({ game }) => game.genres), TOP_GENRES),
    themes: topValues(
      library.flatMap(({ game }) => game.themes).filter((theme) => theme !== "Erotic"),
      TOP_THEMES,
    ),
    gameModes: topValues(library.flatMap(({ game }) => game.gameModes), 3),
    keywords: topValues(seedKeywords, TOP_KEYWORDS),
    seedTitles: new Map(seeds.map(({ game }) => [game.igdbId, game.title])),
  };
}

function overlap(values: string[], wanted: string[]): string[] {
  return values.filter((value) => wanted.includes(value));
}

function joinNames(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

// Scores a game on how much it has in common with the library and how hidden it is.
// Returns null when it should not be suggested at all.
function scoreCandidate(
  game: DiscoverCandidate,
  profile: TasteProfile,
): { score: number; reason: string } | null {
  if (game.rating === null || game.rating < MIN_RATING) return null;
  if (game.ratingCount < MIN_RATINGS || game.ratingCount > MAX_RATINGS) return null;

  const genres = overlap(game.genres, profile.genres);
  const themes = overlap(game.themes, profile.themes);
  const modes = overlap(game.gameModes, profile.gameModes);
  const keywords = overlap(game.keywords, profile.keywords);
  const similarTo = game.similarToIgdbIds.flatMap((id) => {
    const title = profile.seedTitles.get(id);
    return title ? [title] : [];
  });

  const taste =
    similarTo.length * 4 + genres.length * 2 + themes.length * 2 + modes.length + keywords.length;
  // A game that matches nothing the player likes is not a discovery for them.
  if (taste === 0) return null;

  // Well rated is worth more, and so is being known by fewer people.
  const quality = (game.rating - MIN_RATING) / 5;
  const hidden = game.ratingCount <= 50 ? 3 : game.ratingCount <= 200 ? 2 : game.ratingCount <= 800 ? 1 : 0;

  let reason: string;
  if (similarTo.length > 0) {
    reason = `Because you play ${joinNames(similarTo.slice(0, 2))}`;
  } else if (themes.length + genres.length > 0) {
    reason = `Shares your taste for ${joinNames([...genres, ...themes].slice(0, 3))}`;
  } else {
    reason = "Fits the way you play";
  }

  return { score: taste + quality + hidden, reason };
}

// Pure ranking step, kept apart from data access so it is easy to test.
// Leaves out what the player owns, anything off Steam, and mature games unless allowed.
export function rankCandidates(
  candidates: DiscoverCandidate[],
  profile: TasteProfile,
  ownedIgdbIds: Set<number>,
  showMature: boolean,
): DiscoverGame[] {
  return candidates
    .filter((game) => !ownedIgdbIds.has(game.igdbId) && game.onSteam)
    .filter((game) => showMature || !isMature(game))
    .flatMap((game) => {
      const scored = scoreCandidate(game, profile);
      return scored ? [{ game, ...scored }] : [];
    })
    .sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title))
    .slice(0, MAX_RESULTS)
    .map(({ game, reason }) => ({
      igdbId: game.igdbId,
      title: game.title,
      coverUrl: game.coverUrl,
      genres: game.genres,
      releaseYear: game.releaseYear,
      rating: game.rating,
      ratingCount: game.ratingCount,
      reason,
    }));
}

export async function discoverGames(userId: string, showMature: boolean): Promise<DiscoverResult> {
  // Only the authenticated user's library is ever read.
  const library = await listLibrary(userId);

  if (library.length === 0) return { games: [], libraryCount: 0 };

  const seeds = pickSeeds(library);
  const profile = buildProfile(library, []);
  const pool = await getDiscoveryPool(
    seeds.map(({ game }) => game.igdbId),
    profile.genres,
  );
  // Keywords come back with the seed games, so the profile is finished once the pool is in.
  const finished = buildProfile(library, pool.seedKeywords);
  const owned = new Set(library.map(({ game }) => game.igdbId));

  return {
    games: rankCandidates(pool.candidates, finished, owned, showMature),
    libraryCount: library.length,
  };
}
