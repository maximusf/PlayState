"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export const clamp = (x: number, low = 0, high = 1) => Math.min(high, Math.max(low, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeOutQuart = (x: number) => 1 - Math.pow(1 - x, 4);
export const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

// Calls `draw` with how far through the roll it is, from 0 to 1, on every frame until it ends.
// `delayMs` is how long until the roll begins. It is negative for a browser that heard about the
// roll late, so every browser is at the same point of the roll at the same moment.
//
// The animations move their parts directly rather than through React state, so a roll never
// re-renders the page sixty times a second.
export function useRollClock(
  delayMs: number,
  durationMs: number,
  draw: (progress: number) => void,
): void {
  const latest = useRef(draw);

  useEffect(() => {
    latest.current = draw;
  });

  useLayoutEffect(() => {
    const start = performance.now() + delayMs;
    let frame = 0;

    const tick = (now: number) => {
      const progress = clamp((now - start) / durationMs);
      latest.current(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    // The first picture is drawn before the browser paints, so nothing flashes in the wrong place.
    latest.current(clamp((performance.now() - start) / durationMs));
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [delayMs, durationMs]);
}
