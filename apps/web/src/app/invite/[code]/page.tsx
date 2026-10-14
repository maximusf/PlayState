import type { Metadata } from "next";
import Link from "next/link";
import { fetchPartyPreview, playersLabel, truncate } from "@/lib/party-preview";
import { SITE_URL } from "@/lib/site";

// The public face of a party invite. Link crawlers are sent here (see src/proxy.ts)
// because the party page itself needs a signed-in player. It shows only the preview.
type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const preview = await fetchPartyPreview(code);
  const url = `/party/${code}`;
  const image = { url: `/invite/${code}/opengraph-image`, width: 1200, height: 630, alt: "A PlayState party invite" };

  const title = preview.active
    ? `Join ${truncate(preview.name, 40)} on PlayState`
    : "This PlayState party has ended";
  const description = preview.active
    ? `${playersLabel(preview.memberCount)}${preview.hostName ? `, hosted by ${truncate(preview.hostName, 24)}` : ""}. Open the invite to see what you can all play.`
    : "Parties last one day. Start a new one and find a game everyone owns.";

  return {
    metadataBase: new URL(SITE_URL),
    title: { absolute: title },
    description,
    // Invites are private, so search engines should not list them.
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: "PlayState", title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function InvitePage({ params }: Props) {
  const { code } = await params;
  const preview = await fetchPartyPreview(code);

  return (
    <div className="mx-auto max-w-xl py-8 text-center">
      <p className="pixel-label text-pine">{preview.active ? "You are invited" : "Party ended"}</p>
      <h1 className="mt-3 break-words font-pixel text-4xl text-forest">
        {preview.active ? truncate(preview.name, 40) : "This party is gone"}
      </h1>
      <p className="mt-3 text-muted">
        {preview.active
          ? `${playersLabel(preview.memberCount)}${preview.hostName ? `. Hosted by ${truncate(preview.hostName, 24)}.` : "."}`
          : "Parties last one day. Ask for a new link or start your own."}
      </p>
      <Link
        href={preview.active ? `/party/${code}` : "/party"}
        className="btn btn-primary btn-lg mt-8"
      >
        {preview.active ? "Open the invite" : "Start a party"}
      </Link>
    </div>
  );
}
