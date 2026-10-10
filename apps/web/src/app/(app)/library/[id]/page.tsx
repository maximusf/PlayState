import type { Metadata } from "next";
import { GameView } from "./game-view";

export const metadata: Metadata = { title: "Game details" };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <GameView id={id} />;
}
