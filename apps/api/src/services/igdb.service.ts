import { AppError } from "../lib/errors";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_URL = "https://api.igdb.com/v4";
const REQUEST_TIMEOUT_MS = 8000;

// Search only returns things a player would add to a library.
// game_type keeps main games (0), standalone expansions (4), remakes (8), remasters (9),
// expanded games (10), and ports (11). It drops DLC, packs, seasons, bundles, mods, and updates.
// version_parent = null drops special editions of a game that is already listed.
const PLAYABLE_GAMES = "game_type = (0,4,8,9,10,11) & version_parent = null";

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
