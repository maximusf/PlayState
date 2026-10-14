import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { fetchPartyPreview, playersLabel, truncate } from "@/lib/party-preview";

export const alt = "A PlayState party invite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colors from DESIGN.md.
const C = {
  paper: "#D9EAD7",
  surface: "#FAFBF8",
  fern: "#8FB58C",
  pine: "#065F46",
  mint: "#A7F3D0",
  emerald: "#10B981",
  forest: "#0F2D23",
};

// Jersey 10 has Latin letters, digits and common punctuation. Anything else (other
// scripts) would draw as an empty box, so it is dropped. Emoji are drawn separately.
const UNSUPPORTED =
  /[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\p{Extended_Pictographic}‍️]/gu;

function clean(text: string, max: number): string {
  return truncate(text.replace(UNSUPPORTED, "").replace(/\s+/g, " "), max);
}

// Four hard shadows give the frame its stepped pixel corners.
const frame = (color: string, drop = 0) =>
  `-8px 0 0 0 ${color}, 8px 0 0 0 ${color}, 0 -8px 0 0 ${color}, 0 ${8 + drop}px 0 0 ${color}`;

function Mark() {
  return (
    <svg width="64" height="64" viewBox="0 0 16 16" shapeRendering="crispEdges">
      <path d="M1 0h14v1h1v14h-1v1H1v-1H0V1h1z" fill={C.emerald} />
      <path d="M1 0h14v1H1v14H0V1h1z" fill={C.mint} />
      <path d="M15 1h1v14h-1v1H1v-1h14z" fill={C.pine} />
      <path d="M5 4h2v1h2v1h2v1h2v2h-2v1H9v1H7v1H5z" fill={C.forest} />
    </svg>
  );
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [preview, font] = await Promise.all([
    fetchPartyPreview(code),
    readFile(new URL("./Jersey10-Regular.ttf", import.meta.url)),
  ]);

  const active = preview.active;
  const name = active ? clean(preview.name, 40) || "A PlayState party" : "Party ended";
  // Longer names get smaller type so two lines always fit inside the card.
  const nameSize = name.length <= 14 ? 120 : name.length <= 24 ? 92 : 72;
  const host = active && preview.hostName ? clean(preview.hostName, 24) : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: C.paper,
          padding: 56,
          fontFamily: "Jersey 10",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            background: C.surface,
            boxShadow: frame(C.forest),
            padding: "36px 56px",
            color: C.forest,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Mark />
              <div style={{ fontSize: 64, lineHeight: 1 }}>PlayState</div>
            </div>
            <div
              style={{
                display: "flex",
                background: C.mint,
                boxShadow: frame(C.forest),
                padding: "6px 20px",
                fontSize: 34,
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            >
              {active ? "Party invite" : "Party ended"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 44, color: C.pine, letterSpacing: 3, textTransform: "uppercase" }}>
              {active ? "Join" : "This party is gone"}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: nameSize,
                lineHeight: 1,
                wordBreak: "break-word",
                maxHeight: nameSize * 2.1,
                overflow: "hidden",
              }}
            >
              {name}
            </div>
            <div style={{ display: "flex", fontSize: 44, color: C.pine }}>
              {active
                ? `${playersLabel(preview.memberCount)}${host ? ` · hosted by ${host}` : ""}`
                : "Parties last one day"}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div
              style={{
                display: "flex",
                background: C.emerald,
                boxShadow: frame(C.forest, 8),
                padding: "8px 36px",
                fontSize: 48,
                whiteSpace: "nowrap",
                letterSpacing: 3,
                textTransform: "uppercase",
              }}
            >
              {active ? "Join the party" : "Start your own"}
            </div>
            <div style={{ fontSize: 30, color: C.pine, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap" }}>
              Find the right game for right now
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Jersey 10", data: font, style: "normal", weight: 400 }],
    },
  );
}
