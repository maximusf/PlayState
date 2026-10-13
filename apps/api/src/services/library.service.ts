import { Prisma } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import {
  findGamesBySteamAppIds,
  getGameDetails,
  getGamesDetails,
  getTimesToBeatHours,
  getTimeToBeatHours,
} from "./igdb.service";
import { matchingPickerChoices } from "./preferences";
import { getOwnedGames, resolveSteamId } from "./steam.service";

// Every library query loads the game with the entry.
const withGame = { game: true } as const;

type UserGameWithGame = Prisma.UserGameGetPayload<{ include: typeof withGame }>;

type SessionLength = "SHORT" | "MEDIUM" | "LONG";

export type LibraryEntry = ReturnType<typeof toLibraryEntry>;

function toLibraryEntry(entry: UserGameWithGame) {
  return {
    id: entry.id,
    addedAt: entry.createdAt.toISOString(),
    // The player's own tag for how long their sittings with this game are.
    sessionLength: entry.sessionLength as SessionLength | null,
    game: {
      igdbId: entry.game.igdbId,
      title: entry.game.title,
      coverUrl: entry.game.coverUrl,
      genres: entry.game.genres,
      themes: entry.game.themes,
      gameModes: entry.game.gameModes,
      releaseDate: entry.game.releaseDate?.toISOString().slice(0, 10) ?? null,
      timeToBeatHours: entry.game.timeToBeatHours,
    },
  };
}

export async function countLibrary(userId: string): Promise<number> {
  return prisma.userGame.count({ where: { userId } });
}

export async function listLibrary(userId: string): Promise<LibraryEntry[]> {
  const entries = await prisma.userGame.findMany({
    where: { userId },
    include: withGame,
    orderBy: { createdAt: "desc" },
  });

  return entries.map(toLibraryEntry);
}

async function findOwnedEntry(userId: string, id: string): Promise<UserGameWithGame> {
  // Scoping the lookup to userId means another user's entry is never returned.
  const entry = await prisma.userGame.findFirst({
    where: { id, userId },
    include: withGame,
  });

  if (!entry) {
    throw new AppError(404, "LIBRARY_ITEM_NOT_FOUND", "That library item could not be found.");
  }

  return entry;
}

export type LibraryEntryDetail = LibraryEntry & {
  summary: string | null;
  platforms: string[];
  pickerChoices: string[];
};

export async function getLibraryEntry(userId: string, id: string): Promise<LibraryEntryDetail> {
  const entry = await findOwnedEntry(userId, id);

  // Games added before time to beat was stored get it filled in on first view.
  if (entry.game.timeToBeatHours === null) {
    const hours = await getTimeToBeatHours(entry.game.igdbId).catch(() => null);

    if (hours !== null) {
      await prisma.game.update({ where: { id: entry.gameId }, data: { timeToBeatHours: hours } });
      entry.game.timeToBeatHours = hours;
    }
  }

  // The summary and platforms are not stored. If IGDB is down, the page still works without them.
  const details = await getGameDetails(entry.game.igdbId).catch(() => null);

  return {
    ...toLibraryEntry(entry),
    summary: details?.summary ?? null,
    platforms: details?.platforms ?? [],
    pickerChoices: matchingPickerChoices(entry.game),
  };
}

export async function addGameToLibrary(userId: string, igdbId: number): Promise<LibraryEntry> {
  // Game data always comes from IGDB, never from the client.
  const details = await getGameDetails(igdbId);

  if (!details) {
    throw new AppError(404, "GAME_NOT_FOUND", "That game could not be found.");
  }

  // Time to beat is a nice-to-have. A failure here must not block adding the game.
  const timeToBeatHours = await getTimeToBeatHours(igdbId).catch(() => null);

  const metadata = {
    title: details.title,
    timeToBeatHours,
    coverUrl: details.coverUrl,
    releaseDate: details.releaseDate ? new Date(details.releaseDate) : null,
    genres: details.genres,
    themes: details.themes,
    gameModes: details.gameModes,
  };

  const game = await prisma.game.upsert({
    where: { igdbId },
    create: { igdbId, ...metadata },
    update: metadata,
  });

  try {
    const entry = await prisma.userGame.create({
      data: { userId, gameId: game.id },
      include: withGame,
    });

    return toLibraryEntry(entry);
  } catch (error) {
    // P2002: the (userId, gameId) unique constraint rejected a duplicate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "GAME_ALREADY_ADDED", "That game is already in your library.");
    }
    throw error;
  }
}

export type SteamImportPreview = {
  games: {
    igdbId: number;
    title: string;
    coverUrl: string | null;
    genres: string[];
    releaseYear: number | null;
    playtimeMinutes: number;
    // ISO timestamp of the last session on Steam. Null when never played or not shared.
    lastPlayedAt: string | null;
    // A free-to-play game on Steam that the player never paid for.
    free: boolean;
    inLibrary: boolean;
  }[];
  // Steam's own names for the apps IGDB could not place.
  unmatched: string[];
};

export async function previewSteamImport(
  userId: string,
  profile: string,
): Promise<SteamImportPreview> {
  const owned = await getOwnedGames(await resolveSteamId(profile));
  const matches = await findGamesBySteamAppIds(owned.map((game) => game.appId));

  // Two Steam apps can be the same IGDB game, such as a game and its special edition.
  // They become one row with their playtime added together.
  const games = new Map<number, SteamImportPreview["games"][number]>();
  const unmatched: string[] = [];

  for (const steamGame of owned) {
    const match = matches.get(steamGame.appId);

    if (!match) {
      unmatched.push(steamGame.name);
      continue;
    }

    const existing = games.get(match.igdbId);
    const lastPlayedAt = steamGame.lastPlayedAt?.toISOString() ?? null;

    if (existing) {
      existing.playtimeMinutes += steamGame.playtimeMinutes;
      // ISO timestamps sort as text, so the later of the two is the larger string.
      if (lastPlayedAt && lastPlayedAt > (existing.lastPlayedAt ?? "")) {
        existing.lastPlayedAt = lastPlayedAt;
      }
      existing.free &&= steamGame.free;
    } else {
      games.set(match.igdbId, {
        igdbId: match.igdbId,
        title: match.title,
        coverUrl: match.coverUrl,
        genres: match.genres,
        releaseYear: match.releaseDate ? Number(match.releaseDate.slice(0, 4)) : null,
        playtimeMinutes: steamGame.playtimeMinutes,
        lastPlayedAt,
        free: steamGame.free,
        inLibrary: false,
      });
    }
  }

  // A game added by hand has the same IGDB ID, so it shows up here as already owned.
  const entries = await prisma.userGame.findMany({
    where: { userId, game: { igdbId: { in: [...games.keys()] } } },
    select: { game: { select: { igdbId: true } } },
  });

  for (const entry of entries) {
    const game = games.get(entry.game.igdbId);
    if (game) game.inLibrary = true;
  }

  return {
    games: [...games.values()].sort(
      (a, b) => b.playtimeMinutes - a.playtimeMinutes || a.title.localeCompare(b.title),
    ),
    unmatched: unmatched.sort((a, b) => a.localeCompare(b)),
  };
}

export type ImportResult = { added: number; skipped: number };

export async function importGames(userId: string, igdbIds: number[]): Promise<ImportResult> {
  const ids = [...new Set(igdbIds)];

  const stored = await prisma.game.findMany({
    where: { igdbId: { in: ids } },
    select: { igdbId: true },
  });
  const storedIds = new Set(stored.map((game) => game.igdbId));
  const missing = ids.filter((id) => !storedIds.has(id));

  if (missing.length > 0) {
    // Game data always comes from IGDB, never from the client.
    const details = await getGamesDetails(missing);
    // Time to beat is a nice-to-have. A failure here must not block the import.
    const hours = await getTimesToBeatHours(missing).catch(() => new Map<number, number>());

    await prisma.game.createMany({
      data: details.map((game) => ({
        igdbId: game.igdbId,
        title: game.title,
        timeToBeatHours: hours.get(game.igdbId) ?? null,
        coverUrl: game.coverUrl,
        releaseDate: game.releaseDate ? new Date(game.releaseDate) : null,
        genres: game.genres,
        themes: game.themes,
        gameModes: game.gameModes,
      })),
      skipDuplicates: true,
    });
  }

  const games = await prisma.game.findMany({
    where: { igdbId: { in: ids } },
    select: { id: true },
  });

  // The (userId, gameId) unique constraint skips games already in the library.
  const { count } = await prisma.userGame.createMany({
    data: games.map((game) => ({ userId, gameId: game.id })),
    skipDuplicates: true,
  });

  return { added: count, skipped: ids.length - count };
}

export async function setSessionLength(
  userId: string,
  id: string,
  sessionLength: SessionLength | null,
): Promise<LibraryEntry> {
  // Scoping the update to userId means another user's entry is never changed.
  const { count } = await prisma.userGame.updateMany({
    where: { id, userId },
    data: { sessionLength },
  });

  if (count === 0) {
    throw new AppError(404, "LIBRARY_ITEM_NOT_FOUND", "That library item could not be found.");
  }

  return toLibraryEntry(await findOwnedEntry(userId, id));
}

// Removes everything stored for a user. Called when their account is deleted.
export async function deleteLibrary(userId: string): Promise<number> {
  const { count } = await prisma.userGame.deleteMany({ where: { userId } });

  return count;
}

export async function removeGameFromLibrary(userId: string, id: string): Promise<void> {
  // Scoping the delete to userId means another user's entry is never matched.
  const { count } = await prisma.userGame.deleteMany({
    where: { id, userId },
  });

  if (count === 0) {
    throw new AppError(404, "LIBRARY_ITEM_NOT_FOUND", "That library item could not be found.");
  }
}
