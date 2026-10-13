import { prisma } from "../lib/prisma";

export type Stats = { players: number };

// A player is anyone with at least one game in their library.
export async function getStats(): Promise<Stats> {
  const players = await prisma.userGame.groupBy({ by: ["userId"] });

  return { players: players.length };
}
