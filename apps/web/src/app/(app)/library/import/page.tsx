import type { Metadata } from "next";
import { ImportSteamView } from "./import-steam-view";

export const metadata: Metadata = { title: "Import from Steam" };

export default function ImportSteamPage() {
  return <ImportSteamView />;
}
