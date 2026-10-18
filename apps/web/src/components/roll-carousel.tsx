"use client";

import { useRef } from "react";
import { GameCover } from "@/components/ui";
import { clamp, easeOutQuart, useRollClock } from "@/components/roll-clock";
import type { RollProps } from "@/lib/roll-games";
import "./roll-stage.css";

// Where the middle starts, so there are covers to the left of it from the first frame.
const FIRST = 5;
// Covers this far from the middle or further are not drawn.
const REACH = 4.6;
const SPACING = 64;

// Covers sweep past in a 3D row and slow down until the picked game is in the middle.
export function CarouselRoll({ games, winner, delayMs, durationMs }: RollProps) {
  const count = games.length;
  // The row is one long strip. It travels at least two dozen covers, and ends on the winner.
  const gap = (winner - (FIRST % count) + count) % count;
  const last = FIRST + gap + count * Math.max(0, Math.ceil((24 - gap) / count));
  const total = last + 6;
  const items = useRef<(HTMLDivElement | null)[]>([]);

  useRollClock(delayMs, durationMs, (progress) => {
    const middle = FIRST + (last - FIRST) * easeOutQuart(progress);

    items.current.forEach((element, index) => {
      if (!element) return;

      const offset = index - middle;
      const away = Math.abs(offset);

      if (away > REACH) {
        if (element.style.display !== "none") element.style.display = "none";
        return;
      }

      const turn = -clamp(offset, -3, 3) * 32;
      const settled = progress >= 1 && Math.round(offset) !== 0;

      element.style.display = "block";
      element.style.transform = `translateX(${(offset * SPACING).toFixed(1)}px) translateZ(${(-away * 40).toFixed(1)}px) rotateY(${turn.toFixed(1)}deg) scale(${(1.25 - Math.min(away, 3) * 0.1).toFixed(3)})`;
      element.style.zIndex = String(100 - Math.round(away * 10));
      element.style.opacity = String(settled ? 0.45 : Math.max(0.2, 1 - Math.max(0, away - 3) * 0.5));
    });
  });

  return (
    <div className="roll-flow" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => {
        const game = games[index % count];

        return (
          <div
            key={index}
            ref={(element) => {
              items.current[index] = element;
            }}
            className="roll-flow-item"
          >
            <GameCover title={game.title} coverUrl={game.coverUrl} className="ring-2 ring-forest" eager />
          </div>
        );
      })}
    </div>
  );
}
