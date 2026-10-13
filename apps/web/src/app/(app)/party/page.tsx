import type { Metadata } from "next";
import { PartiesView } from "./parties-view";

export const metadata: Metadata = { title: "Play together" };

export default function PartiesPage() {
  return <PartiesView />;
}
