import { AppError } from "../lib/errors";

const STEAM_API_URL = "https://api.steampowered.com";
// A large library is one big response, so Steam gets longer than IGDB does.
const REQUEST_TIMEOUT_MS = 15_000;

export type OwnedSteamGame = {
  appId: number;
  name: string;
  playtimeMinutes: number;
  // Null when the game was never played, or when Steam does not share the date.
  lastPlayedAt: Date | null;
  // True for a free-to-play game the player never paid for.
  free: boolean;
};

type OwnedGamesResponse = {
  // rtime_last_played is in Unix seconds, and 0 for a game that was never played.
  games?: { appid: number; name?: string; playtime_forever?: number; rtime_last_played?: number }[];
};

type ProfileReference = { steamId: string } | { vanityName: string };

function unavailable(): AppError {
  return new AppError(502, "STEAM_UNAVAILABLE", "Steam is unavailable right now. Try again soon.");
}

function getApiKey(): string {
  const key = process.env.STEAM_API_KEY;

  if (!key) {
    console.error("Steam is not configured: missing STEAM_API_KEY.");
    throw unavailable();
  }

  return key;
}

// Accepts a profile link, a 17-digit Steam ID, or a custom profile name.
export function parseProfile(input: string): ProfileReference | null {
  const value = input.trim();

  const idLink = value.match(/steamcommunity\.com\/profiles\/(\d{17})(?:[/?#]|$)/i);
  if (idLink) return { steamId: idLink[1] };

  const nameLink = value.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (nameLink) return { vanityName: nameLink[1] };

  if (/^\d{17}$/.test(value)) return { steamId: value };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(value)) return { vanityName: value };

  return null;
}

async function callSteam<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ key: getApiKey(), ...params });

  try {
    const response = await fetch(`${STEAM_API_URL}/${path}/?${query}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Steam request to ${path} failed with status ${response.status}.`);
      throw unavailable();
    }

    return ((await response.json()) as { response: T }).response;
  } catch (error) {
    if (error instanceof AppError) throw error;

    // Network failures and timeouts. The URL holds the API key, so it is never logged.
    console.error(`Steam request to ${path} failed:`, error instanceof Error ? error.name : error);
    throw unavailable();
  }
}

export async function resolveSteamId(profile: string): Promise<string> {
  const reference = parseProfile(profile);

  if (!reference) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Enter a Steam profile link, like https://steamcommunity.com/id/yourname.",
    );
  }

  if ("steamId" in reference) return reference.steamId;

  const result = await callSteam<{ success?: number; steamid?: string }>(
    "ISteamUser/ResolveVanityURL/v1",
    { vanityurl: reference.vanityName },
  );

  if (result?.success !== 1 || !result.steamid) {
    throw new AppError(
      404,
      "STEAM_PROFILE_NOT_FOUND",
      "That Steam profile could not be found. Check the link and try again.",
    );
  }

  return result.steamid;
}

export async function getOwnedGames(steamId: string): Promise<OwnedSteamGame[]> {
  const request = (includeFree: boolean) =>
    callSteam<OwnedGamesResponse>("IPlayerService/GetOwnedGames/v1", {
      steamid: steamId,
      include_appinfo: String(includeFree),
      include_played_free_games: String(includeFree),
      skip_unvetted_apps: "false",
    });

  // Steam does not say which games are free. Asking twice, with and without free games,
  // shows it: a game missing from the second answer is one the player never paid for.
  const [result, withoutFree] = await Promise.all([request(true), request(false)]);
  const paid = new Set((withoutFree?.games ?? []).map((game) => game.appid));

  // Steam answers with an empty object, not an error, when it will not share the games.
  if (!result?.games?.length) {
    throw new AppError(
      422,
      "STEAM_LIBRARY_HIDDEN",
      "Steam did not share any games for that profile. In Steam, set Game details to Public under Edit Profile, Privacy Settings, then try again.",
    );
  }

  return result.games.map((game) => ({
    appId: game.appid,
    name: game.name ?? `Steam app ${game.appid}`,
    playtimeMinutes: game.playtime_forever ?? 0,
    lastPlayedAt: game.rtime_last_played ? new Date(game.rtime_last_played * 1000) : null,
    free: !paid.has(game.appid),
  }));
}
