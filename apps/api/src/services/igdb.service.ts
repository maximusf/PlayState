import { AppError } from "../lib/errors";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const REQUEST_TIMEOUT_MS = 8000;

export type GameSearchResult = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
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

async function queryGames(query: string, isRetry = false): Promise<IgdbGame[]> {
  try {
    const { clientId } = getCredentials();
    const token = await getAccessToken();

    const response = await fetch(IGDB_GAMES_URL, {
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
      return queryGames(query, true);
    }

    if (!response.ok) {
      console.error(`IGDB request failed with status ${response.status}.`);
      throw unavailable();
    }

    return (await response.json()) as IgdbGame[];
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
    `search "${escaped}"; fields name,cover.image_id,genres.name,first_release_date; limit 20;`,
  );

  return games.map((game) => ({
    igdbId: game.id,
    title: game.name ?? "Untitled",
    coverUrl: coverUrl(game),
    genres: names(game.genres),
    releaseYear: releaseDate(game)?.getUTCFullYear() ?? null,
  }));
}

export async function getGameDetails(igdbId: number): Promise<GameDetails | null> {
  const [game] = await queryGames(
    `fields name,cover.image_id,genres.name,themes.name,game_modes.name,platforms.name,first_release_date; where id = ${igdbId}; limit 1;`,
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
  };
}
