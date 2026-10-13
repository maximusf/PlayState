import type { Metadata } from "next";
import { PartyView } from "./party-view";

export const metadata: Metadata = { title: "Party" };

export default async function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return <PartyView code={code} />;
}
