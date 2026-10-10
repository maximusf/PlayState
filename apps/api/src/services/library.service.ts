import { Prisma } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getGameDetails } from "./igdb.service";

type UserGameWithGame = Prisma.UserGameGetPayload<{ include: { game: true } }>;

export type LibraryEntry = ReturnType<typeof toLibraryEntry>;

function toLibraryEntry(entry: UserGameWithGame) {
  return {
    id: entry.id,
    addedAt: entry.createdAt.toISOString(),
    game: {
      igdbId: entry.game.igdbId,
      title: entry.game.title,
      coverUrl: entry.game.coverUrl,
      genres: entry.game.genres,
      themes: entry.game.themes,
      gameModes: entry.game.gameModes,
      releaseDate: entry.game.releaseDate?.toISOString().slice(0, 10) ?? null,
    },
  };
}

export async function listLibrary(userId: string): Promise<LibraryEntry[]> {
  const entries = await prisma.userGame.findMany({
    where: { userId },
    include: { game: true },
    orderBy: { createdAt: "desc" },
  });

  return entries.map(toLibraryEntry);
}

export async function addGameToLibrary(userId: string, igdbId: number): Promise<LibraryEntry> {
  // Game data always comes from IGDB, never from the client.
  const details = await getGameDetails(igdbId);

  if (!details) {
    throw new AppError(404, "GAME_NOT_FOUND", "That game could not be found.");
  }

  const metadata = {
    title: details.title,
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
      include: { game: true },
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

export async function removeGameFromLibrary(userId: string, id: string): Promise<void> {
  // Scoping the delete to userId means another user's entry is never matched.
  const { count } = await prisma.userGame.deleteMany({
    where: { id, userId },
  });

  if (count === 0) {
    throw new AppError(404, "LIBRARY_ITEM_NOT_FOUND", "That library item could not be found.");
  }
}
