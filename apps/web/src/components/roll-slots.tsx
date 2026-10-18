"use client";

import { useMemo, useRef } from "react";
import { GameCover } from "@/components/ui";
import { clamp, easeOutCubic, easeOutQuart, useRollClock } from "@/components/roll-clock";
import type { RollProps } from "@/lib/roll-games";
import { mulberry32, shuffled } from "@/lib/seeded";
import "./roll-stage.css";

const ROW = 90;
// How many times each reel's strip repeats the games. The picked game is in the last lap.
const LAPS = 3;
// When, as a share of the roll, each reel is done. The last one takes the longest.
const STOPS = [0.6, 0.8, 1];
const REELS = [0, 1, 2];

// Three reels stop one after another and all land on the picked game. The third reel nearly
// stops one game early, then creeps onto the match.
export function SlotsRoll({ games, winner, seed, delayMs, durationMs }: RollProps) {
  const count = games.length;
  const strips = useRef<(HTMLDivElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);

  // Each reel has its own order, so the three do not line up until they land.
  const reels = useMemo(
    () =>
      REELS.map((reel) => {
        const order = shuffled(
          games.map((_, index) => index),
          mulberry32(seed + 31 * (reel + 1)),
        );
        return { order, landing: (LAPS - 1) * count + order.indexOf(winner) };
      }),
    [games, winner, seed, count],
  );

  useRollClock(delayMs, durationMs, (progress) => {
    REELS.forEach((reel) => {
      const strip = strips.current[reel];
      if (!strip) return;

      const done = clamp(progress / STOPS[reel]);
      const landing = reels[reel].landing;
      const offset =
        reel < 2
          ? landing * ROW * easeOutQuart(done)
          : (landing - 1) * ROW * easeOutQuart(Math.min(1, done / 0.9)) +
            (done > 0.9 ? ROW * easeOutCubic((done - 0.9) / 0.1) : 0);

      strip.style.transform = `translateY(${ROW - offset}px)`;
      strip.style.filter = `blur(${((1 - done) ** 2 * 2.2).toFixed(2)}px)`;
    });

    box.current?.classList.toggle("is-hit", progress >= 1);
  });

  return (
    <div ref={box} className="roll-slots" aria-hidden="true">
      {REELS.map((reel) => (
        <div key={reel} className="roll-reel">
          <div
            ref={(element) => {
              strips.current[reel] = element;
            }}
            className="roll-reel-strip"
          >
            {Array.from({ length: count * LAPS }, (_, index) => {
              const game = games[reels[reel].order[index % count]];

              return (
                <div key={index} className="roll-reel-item">
                  <GameCover title={game.title} coverUrl={game.coverUrl} className="w-16 ring-2 ring-forest" eager />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="roll-slot-mark" />
    </div>
  );
}
