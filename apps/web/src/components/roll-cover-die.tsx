"use client";

import { useMemo, useRef } from "react";
import { GameCover } from "@/components/ui";
import { useRollClock } from "@/components/roll-clock";
import { rigidRoll, rollFraction, rollPose } from "@/lib/roll-physics";
import type { RollGame, RollProps } from "@/lib/roll-games";
import "./roll-stage.css";

const FACES = [1, 2, 3, 4, 5, 6];

// A die with a game's cover on every face, thrown into a tray with real physics. It lands with
// the picked game's cover facing up. The roll is recorded from a seeded simulation, so every
// member's browser plays the same one.
export function CoverDieRoll({ games, winner, seed, delayMs, durationMs }: RollProps) {
  const roll = useMemo(() => rigidRoll(seed, (seed % 6) + 1), [seed]);
  const cube = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);

  // The pick goes on whichever face the roll ended on. The other faces share out the other games.
  const faces = useMemo(() => {
    const byFace: Record<number, RollGame> = {};
    const others = games.filter((_, index) => index !== winner);
    let next = 0;

    for (const face of FACES) {
      byFace[face] =
        face === roll.face || others.length === 0 ? games[winner] : others[next++ % others.length];
    }

    return byFace;
  }, [games, winner, roll.face]);

  const start = useMemo(() => rollPose(roll, 0).cube, [roll]);

  useRollClock(delayMs, durationMs, (progress) => {
    if (!cube.current || !shadow.current) return;

    const seconds = durationMs / 1000;
    const pose = rollPose(roll, progress >= 1 ? 1 : rollFraction(progress * seconds, seconds, roll));

    cube.current.style.transform = pose.cube;
    shadow.current.style.transform = `translate3d(${pose.x.toFixed(1)}px,-1px,${pose.z.toFixed(1)}px) rotateX(90deg) scale(${(1 - Math.min(0.5, pose.height * 0.18)).toFixed(3)})`;
    shadow.current.style.opacity = (0.34 / (1 + pose.height * 1.2)).toFixed(3);
  });

  return (
    <div className="roll-scene" aria-hidden="true">
      <div className="roll-world">
        <div className="roll-floor" />
        <div ref={shadow} className="roll-shadow" />
        <div ref={cube} className="roll-cube" style={{ transform: start }}>
          {FACES.map((face) => (
            <div key={face} className="roll-face" data-face={face}>
              <GameCover title={faces[face].title} coverUrl={faces[face].coverUrl} className="h-full" eager />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
