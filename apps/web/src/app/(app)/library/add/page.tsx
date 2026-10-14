import type { Metadata } from "next";
import { AddGameView } from "./add-game-view";

export const metadata: Metadata = { title: "Add a game" };

export default async function AddGamePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  // A shared link can carry a title to search for. The input caps it at 100 characters.
  const initialQuery = (typeof q === "string" ? q : "").slice(0, 100);

  return <AddGameView initialQuery={initialQuery} />;
}
