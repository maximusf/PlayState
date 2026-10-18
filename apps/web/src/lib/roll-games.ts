import { mulberry32, shuffled } from "@/lib/seeded";

// A game as the roll animations need it.
export type RollGame = { igdbId: number; title: string; coverUrl: string | null };

// What every roll animation is given. `winner` is the index of the picked game in `games`, which
// is already mixed and trimmed to what the animation can show.
export type RollProps = {
  games: RollGame[];
  winner: number;
  seed: number;
  // How long until the roll begins. Negative for a browser that heard about it late.
  delayMs: number;
  durationMs: number;
};

// Chooses the games an animation shows, always including the winner. The same seed gives the
// same games in the same order in every browser.
export function pickContenders(
  games: RollGame[],
  winnerId: number,
  limit: number,
  seed: number,
): { list: RollGame[]; winner: number } | null {
  const winner = games.find((game) => game.igdbId === winnerId);
  if (!winner) return null;

  const random = mulberry32(seed);
  const others = shuffled(
    games.filter((game) => game.igdbId !== winnerId),
    random,
  ).slice(0, Math.max(0, limit - 1));
  const list = shuffled([winner, ...others], random);

  return { list, winner: list.findIndex((game) => game.igdbId === winnerId) };
}
