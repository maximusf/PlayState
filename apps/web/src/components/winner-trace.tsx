"use client";

import { useEffect, useRef, useState } from "react";

// The mark on a game a dice roll or a spin has landed on: a soft gold outline with three
// glowing strokes chasing each other round it. The values come from the Winner Trace Tuner.
const GOLD = "#e9cd78";
const THICKNESS = 6;
const STROKES = 3;
// Each stroke's length, as a share of the whole frame out of 100.
const LENGTH = 20;
const STRENGTH = 0.8;
const OUTLINE_STRENGTH = 0.4;
// A stroke fades towards its tail. It is drawn as this many strokes of growing length stacked
// on one another, all ending at the same leading point, so it is brightest at the front.
const TAIL_STEPS = 6;
const GLOW = 12;
const LAP_MS = 3000;
// Room around the frame for the glow, which would otherwise be cut off.
const PAD = 16;
const NOTCH = 4;

// The frame's outline, starting top left and running clockwise. Notched matches pixel-frame.
function outline(x: number, y: number, w: number, h: number, notched: boolean): string {
  if (!notched) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

  const n = NOTCH;
  return `M${x + n} ${y}H${x + w - n}V${y + n}H${x + w}V${y + h - n}H${x + w - n}V${y + h}H${x + n}V${y + h - n}H${x}V${y + n}H${x + n}Z`;
}

// Place inside a positioned element. It measures that element and draws around its edge.
export function WinnerTrace({ notched = false }: { notched?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;

    // Fires once straight away, and again whenever the card changes size.
    const observer = new ResizeObserver(() => {
      setSize({ width: parent.offsetWidth, height: parent.offsetHeight });
    });
    observer.observe(parent);

    return () => observer.disconnect();
  }, []);

  // Sets the strokes moving. This is done here and not in the stylesheet so the movement
  // cannot be lost to a stale stylesheet, and so it restarts cleanly when the card resizes.
  useEffect(() => {
    if (!size || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const strokes = ref.current?.querySelectorAll<SVGPathElement>("path[data-from]") ?? [];
    const running = Array.from(strokes, (stroke) => {
      const from = Number(stroke.dataset.from);
      // One lap moves a stroke the whole way round the outline, which is 100 units long.
      return stroke.animate([{ strokeDashoffset: from }, { strokeDashoffset: from - 100 }], {
        duration: LAP_MS,
        iterations: Infinity,
      });
    });

    return () => running.forEach((animation) => animation.cancel());
  }, [size]);

  const reach = THICKNESS / 2 + PAD;
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const path = outline(reach, reach, width, height, notched);

  // The strokes start at the top centre. Positions are measured along the outline, out of 100.
  const start = width + height > 0 ? (100 * (width / 2)) / (2 * (width + height)) : 0;
  const period = 100 / STROKES;
  const stepStrength = 1 - Math.pow(1 - STRENGTH, 1 / TAIL_STEPS);
  const steps = Array.from({ length: TAIL_STEPS }, (_, index) => (LENGTH * (index + 1)) / TAIL_STEPS);

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      focusable="false"
      width={width + reach * 2}
      height={height + reach * 2}
      className="pointer-events-none absolute overflow-visible"
      style={{ left: -reach, top: -reach, filter: `drop-shadow(0 0 ${GLOW}px ${GOLD})` }}
    >
      {size && (
        <g fill="none" stroke={GOLD} strokeWidth={THICKNESS} strokeLinecap="round" strokeLinejoin="round">
          <path d={path} strokeOpacity={OUTLINE_STRENGTH} />
          {steps.map((part) => {
            // Where this step sits at rest, so its leading end lines up with the others.
            const from = part - LENGTH - start;

            return (
              <path
                key={part}
                d={path}
                pathLength={100}
                strokeOpacity={stepStrength}
                strokeDasharray={`${part} ${period - part}`}
                strokeDashoffset={from}
                data-from={from}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
}
