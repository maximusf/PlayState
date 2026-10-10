import type { Metadata } from "next";
import { AddGameView } from "./add-game-view";

export const metadata: Metadata = { title: "Add a game" };

export default function AddGamePage() {
  return <AddGameView />;
}
