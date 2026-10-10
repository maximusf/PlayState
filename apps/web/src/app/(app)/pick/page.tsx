import type { Metadata } from "next";
import { PickerView } from "./picker-view";

export const metadata: Metadata = { title: "Pick a game" };

export default function PickPage() {
  return <PickerView />;
}
