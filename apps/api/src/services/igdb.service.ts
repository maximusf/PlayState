import { AppError } from "../lib/errors";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_URL = "https://api.igdb.com/v4";
const REQUEST_TIMEOUT_MS = 8000;

// Search only returns things a player would add to a library.
// game_type keeps main games (0), standalone expansions (4), remakes (8), remasters (9),
// expanded games (10), and ports (11). It drops DLC, packs, seasons, bundles, mods, and updates.
// version_parent = null drops special editions of a game that is already listed.
const PLAYABLE_GAME_TYPES = [0, 4, 8, 9, 10, 11];
const PLAYABLE_GAMES = `game_type = (${PLAYABLE_GAME_TYPES.join(",")}) & version_parent = null`;

// IGDB's ID for Steam in its list of external game sources.
const STEAM_SOURCE = 1;
// IGDB returns at most 500 rows per request. Batches stay under that with room to spare.
const BATCH_SIZE = 400;
const RATE_LIMIT_WAIT_MS = 1000;

// Everything stored for a game. The summary is left out because it is large and never stored.
const GAME_FIELDS =
  "name,cover.image_id,genres.name,themes.name,game_modes.name,platforms.name,first_release_date";

export type GameSearchResult = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
  releaseDate: string | null;
  // IGDB's combined critic and player score out of 100, and how many ratings it is based on.
  rating: number | null;
  ratingCount: number;
};

export type GameDetails = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  themes: string[];
  gameModes: string[];
  platforms: string[];
  releaseDate: string | null;
  summary: string | null;
};

// The subset of IGDB's raw game shape this service asks for.
type IgdbNamed = { name?: string };
type IgdbGame = {
  id: number;
  name?: string;
  cover?: { image_id?: string };
  genres?: IgdbNamed[];
  themes?: IgdbNamed[];
  game_modes?: IgdbNamed[];
  platforms?: IgdbNamed[];
  first_release_date?: number;
  summary?: string;
  game_type?: number;
  version_parent?: number;
  total_rating?: number;
  total_rating_count?: number;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function unavailable(): AppError {
  return new AppError(502, "IGDB_UNAVAILABLE", "The game catalog is unavailable right now.");
}

function getCredentials() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("IGDB is not configured: missing Twitch credentials.");
    throw unavailable();
  }

  return { clientId, clientSecret };
}

async function getAccessToken(): Promise<string> {
  // Refresh a minute early so a token never expires mid-request.
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const response = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.error(`Twitch token request failed with status ${response.status}.`);
    throw unavailable();
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };

  return cachedToken.value;
}

function queryGames(query: string): Promise<IgdbGame[]> {
  return queryIgdb<IgdbGame>("games", query);
}

async function queryIgdb<T>(endpoint: string, query: string, isRetry = false): Promise<T[]> {
  try {
    const { clientId } = getCredentials();
    const token = await getAccessToken();

    const response = await fetch(`${IGDB_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: query,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // A rejected token may have been revoked early. Fetch a new one once.
    if (response.status === 401 && !isRetry) {
      cachedToken = null;
      return queryIgdb<T>(endpoint, query, true);
    }

    // IGDB allows 4 requests a second. Wait out the limit and try once more.
    if (response.status === 429 && !isRetry) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
      return queryIgdb<T>(endpoint, query, true);
    }

    if (!response.ok) {
      console.error(`IGDB request failed with status ${response.status}.`);
      throw unavailable();
    }

    return (await response.json()) as T[];
  } catch (error) {
    if (error instanceof AppError) throw error;

    // Network failures and timeouts. Log the reason, never the credentials.
    console.error("IGDB request failed:", error instanceof Error ? error.message : error);
    throw unavailable();
  }
}

function names(items: IgdbNamed[] | undefined): string[] {
  return (items ?? []).flatMap((item) => (item.name ? [item.name] : []));
}

function coverUrl(game: IgdbGame): string | null {
  const imageId = game.cover?.image_id;
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg` : null;
}

function releaseDate(game: IgdbGame): Date | null {
  // IGDB uses Unix seconds.
  return game.first_release_date === undefined ? null : new Date(game.first_release_date * 1000);
}

function toGameDetails(game: IgdbGame): GameDetails {
  return {
    igdbId: game.id,
    title: game.name ?? "Untitled",
    coverUrl: coverUrl(game),
    genres: names(game.genres),
    themes: names(game.themes),
    gameModes: names(game.game_modes),
    platforms: names(game.platforms),
    releaseDate: releaseDate(game)?.toISOString().slice(0, 10) ?? null,
    summary: game.summary ?? null,
  };
}

function isPlayable(game: IgdbGame): boolean {
  return PLAYABLE_GAME_TYPES.includes(game.game_type ?? 0);
}

function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    result.push(items.slice(start, start + BATCH_SIZE));
  }
  return result;
}

// Batches run one after another to stay inside IGDB's rate limit.
async function queryGamesByIds(igdbIds: number[]): Promise<IgdbGame[]> {
  const games: IgdbGame[] = [];

  for (const batch of batches(igdbIds)) {
    games.push(
      ...(await queryGames(
        `fields ${GAME_FIELDS},game_type,version_parent; where id = (${batch.join(",")}); limit 500;`,
      )),
    );
  }

  return games;
}

export function resetTokenCache(): void {
  cachedToken = null;
}

export async function searchGames(term: string): Promise<GameSearchResult[]> {
  // Apicalypse strings are double-quoted, so escape quotes and backslashes.
  const escaped = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const games = await queryGames(
    `search "${escaped}"; fields name,cover.image_id,genres.name,first_release_date,total_rating,total_rating_count; where ${PLAYABLE_GAMES}; limit 40;`,
  );

  return games.map((game) => ({
    igdbId: game.id,
    title: game.name ?? "Untitled",
    coverUrl: coverUrl(game),
    genres: names(game.genres),
    releaseYear: releaseDate(game)?.getUTCFullYear() ?? null,
    releaseDate: releaseDate(game)?.toISOString().slice(0, 10) ?? null,
    rating: game.total_rating === undefined ? null : Math.round(game.total_rating),
    ratingCount: game.total_rating_count ?? 0,
  }));
}

// IGDB's "normally" time to finish a game, rounded to whole hours. Null when unknown.
// This is how long the whole game takes, not how long one sitting is.
export async function getTimeToBeatHours(igdbId: number): Promise<number | null> {
  const [times] = await queryIgdb<{ normally?: number }>(
    "game_time_to_beats",
    `fields normally; where game_id = ${igdbId}; limit 1;`,
  );

  // IGDB reports seconds.
  return times?.normally ? Math.max(1, Math.round(times.normally / 3600)) : null;
}

export async function getGameDetails(igdbId: number): Promise<GameDetails | null> {
  const [game] = await queryGames(
    `fields name,cover.image_id,genres.name,themes.name,game_modes.name,platforms.name,first_release_date,summary; where id = ${igdbId}; limit 1;`,
  );

  if (!game) return null;

  return toGameDetails(game);
}

// Details for many games at once. Games IGDB does not know are left out. Summaries are null.
export async function getGamesDetails(igdbIds: number[]): Promise<GameDetails[]> {
  return (await queryGamesByIds(igdbIds)).map(toGameDetails);
}

// Time to finish, in whole hours, for each game IGDB has a figure for.
export async function getTimesToBeatHours(igdbIds: number[]): Promise<Map<number, number>> {
  const hours = new Map<number, number>();

  for (const batch of batches(igdbIds)) {
    const rows = await queryIgdb<{ game_id?: number; normally?: number }>(
      "game_time_to_beats",
      `fields game_id,normally; where game_id = (${batch.join(",")}); limit 500;`,
    );

    for (const row of rows) {
      if (row.game_id && row.normally) {
        hours.set(row.game_id, Math.max(1, Math.round(row.normally / 3600)));
      }
    }
  }

  return hours;
}

// Finds the IGDB game behind each Steam app ID. Apps IGDB does not know, and apps that are
// not playable games (DLC, soundtracks, tools), are left out of the result.
export async function findGamesBySteamAppIds(appIds: number[]): Promise<Map<number, GameDetails>> {
  const gameFields = `${GAME_FIELDS},game_type,version_parent`
    .split(",")
    .map((field) => `game.${field}`)
    .join(",");
  const linked = new Map<number, IgdbGame>();

  for (const batch of batches(appIds)) {
    const uids = batch.map((appId) => `"${appId}"`).join(",");
    const rows = await queryIgdb<{ uid?: string; game?: IgdbGame }>(
      "external_games",
      `fields uid,${gameFields}; where external_game_source = ${STEAM_SOURCE} & uid = (${uids}); limit 500;`,
    );

    for (const row of rows) {
      if (!row.uid || !row.game) continue;

      // When IGDB links one app to several entries, a playable game wins over DLC.
      const current = linked.get(Number(row.uid));
      if (!current || (!isPlayable(current) && isPlayable(row.game))) {
        linked.set(Number(row.uid), row.game);
      }
    }
  }

  // A special edition counts as the game it is an edition of, so it cannot be added twice.
  const parentIds = new Set<number>();
  for (const game of linked.values()) {
    if (game.version_parent) parentIds.add(game.version_parent);
  }
  const parents = new Map(
    (await queryGamesByIds([...parentIds])).map((game) => [game.id, game] as const),
  );

  const matches = new Map<number, GameDetails>();
  for (const [appId, game] of linked) {
    const resolved = game.version_parent ? parents.get(game.version_parent) : game;
    if (resolved && isPlayable(resolved)) matches.set(appId, toGameDetails(resolved));
  }

  return matches;
}
