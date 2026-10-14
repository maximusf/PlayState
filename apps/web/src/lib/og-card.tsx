import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { OG_SIZE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// Palette from DESIGN.md.
const PAPER = "#D9EAD7";
const FERN = "#8FB58C";
const PINE = "#065F46";
const MINT = "#A7F3D0";
const EMERALD = "#10B981";
const FOREST = "#0F2D23";
const SURFACE = "#FAFBF8";

const PX = 20; // one logo pixel, on the 16x16 grid

async function loadPixelFont() {
  return readFile(join(process.cwd(), "src/app/fonts/Jersey10-Regular.ttf"));
}

function Mark() {
  const size = 16 * PX;
  // Arrow columns on the 16x16 grid as [x, y, width, height].
  const arrow = [
    [5, 4, 2, 9],
    [7, 5, 2, 7],
    [9, 6, 2, 5],
    [11, 7, 2, 3],
  ];
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: size,
        height: size,
        background: EMERALD,
        borderTop: `${PX}px solid ${MINT}`,
        borderLeft: `${PX}px solid ${MINT}`,
        borderBottom: `${PX}px solid ${PINE}`,
        borderRight: `${PX}px solid ${PINE}`,
      }}
    >
      {arrow.map(([x, y, w, h]) => (
        <div
          key={x}
          style={{
            position: "absolute",
            left: (x - 1) * PX,
            top: (y - 1) * PX,
            width: w * PX,
            height: h * PX,
            background: FOREST,
          }}
        />
      ))}
    </div>
  );
}

function Slot({ n, lit }: { n: number; lit: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 120,
        height: 130,
        background: lit ? MINT : SURFACE,
        border: `8px solid ${lit ? FOREST : FERN}`,
        // A hard drop shadow drawn as a thicker border (satori mis-renders box-shadow).
        borderRightWidth: lit ? 16 : 8,
        borderBottomWidth: lit ? 16 : 8,
        color: lit ? FOREST : FERN,
        fontSize: 88,
        fontFamily: "Jersey 10",
      }}
    >
      {n}
    </div>
  );
}

export async function renderOgCard() {
  const font = await loadPixelFont();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          padding: 36,
          fontFamily: "Jersey 10",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: SURFACE,
            border: `12px solid ${FOREST}`,
            padding: "0 64px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", color: FOREST }}>
            <div style={{ display: "flex", fontSize: 168, lineHeight: 1 }}>{SITE_NAME}</div>
            <div
              style={{ display: "flex", fontSize: 60, lineHeight: 1.1, marginTop: 16, maxWidth: 560 }}
            >
              {SITE_TAGLINE}
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 32 }}>
              <Slot n={1} lit />
              <Slot n={2} lit={false} />
              <Slot n={3} lit={false} />
            </div>
          </div>
          <Mark />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Jersey 10", data: font, style: "normal", weight: 400 }],
    },
  );
}
