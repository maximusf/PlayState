import { Prisma } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getGameDetails, getTimeToBeatHours } from "./igdb.service";
import { matchingPickerChoices } from "./preferences";

// Every library query loads the game and the answers the player chose it for.
const withGame = { game: true, picks: { select: { availableTime: true } } } as const;

type UserGameWithGame = Prisma.UserGameGetPayload<{ include: typeof withGame }>;

type SessionLength = "SHORT" | "MEDIUM" | "LONG";

export type LibraryEntry = ReturnType<typeof toLibraryEntry>;

function toLibraryEntry(entry: UserGameWithGame) {
  return {
    id: entry.id,
    addedAt: entry.createdAt.toISOString(),
    // The player's own tag for how long their sittings with this game are.
    sessionLength: entry.sessionLength as SessionLength | null,
    // The time answers the player gave when they chose this game before.
    pickedFor: entry.picks.map((pick) => pick.availableTime),
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

  // The summary is not stored. If IGDB is down, the page still works without it.
  const summary = await getGameDetails(entry.game.igdbId).then(
    (details) => details?.summary ?? null,
    () => null,
  );

  return {
    ...toLibraryEntry(entry),
    summary,
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

// Records that the player chose this game for the given time answer.
export async function recordPick(userId: string, id: string, availableTime: string): Promise<void> {
  await findOwnedEntry(userId, id);
  await prisma.pick.create({ data: { userId, userGameId: id, availableTime } });
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
