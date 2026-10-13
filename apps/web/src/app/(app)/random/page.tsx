import type { Metadata } from "next";
import { RandomView } from "./random-view";

export const metadata: Metadata = { title: "Random game" };

export default function RandomPage() {
  return <RandomView />;
}
