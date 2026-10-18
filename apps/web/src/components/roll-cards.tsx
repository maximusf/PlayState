"use client";

import { useRef } from "react";
import { GameCover } from "@/components/ui";
import { clamp, easeInOut, easeOutCubic, lerp, useRollClock } from "@/components/roll-clock";
import type { RollProps } from "@/lib/roll-games";
import "./roll-stage.css";

// Covers swirl round in a ring, gather into a stack, and the picked game pops out of the pile
// while the others fall back.
export function CardsRoll({ games, winner, delayMs, durationMs }: RollProps) {
  const count = games.length;
  const cards = useRef<(HTMLDivElement | null)[]>([]);

  useRollClock(delayMs, durationMs, (progress) => {
    const spin = easeInOut(clamp(progress / 0.58)) * Math.PI * 7;
    const gather = easeInOut(clamp((progress - 0.5) / 0.3));
    const reveal = easeOutCubic(clamp((progress - 0.8) / 0.2));

    cards.current.forEach((card, index) => {
      if (!card) return;

      const angle = (index / count) * Math.PI * 2 + spin;
      const radius = lerp(92, 0, gather);
      let x = Math.cos(angle) * radius * 1.2;
      let y = Math.sin(angle) * radius * 0.55;
      let tilt = Math.sin(angle) * 14 * (1 - gather);
      let scale = 1;
      let layer = Math.round(y + 100);
      let opacity = 1;

      if (progress > 0.8) {
        if (index === winner) {
          x = 0;
          y = lerp(0, -6, reveal);
          tilt = 0;
          scale = lerp(1, 1.6, reveal);
          layer = 999;
        } else {
          opacity = lerp(1, 0.18, reveal);
          y += reveal * 26;
        }
      }

      card.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
      card.style.zIndex = String(layer);
      card.style.opacity = String(opacity);
    });
  });

  return (
    <div className="roll-cards" aria-hidden="true">
      {games.map((game, index) => (
        <div
          key={game.igdbId}
          ref={(element) => {
            cards.current[index] = element;
          }}
          className="roll-card"
        >
          <GameCover title={game.title} coverUrl={game.coverUrl} className="ring-2 ring-forest" eager />
        </div>
      ))}
    </div>
  );
}
