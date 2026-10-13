"use client";

import { useEffect, useRef, useState } from "react";

// The dice hops between choices for about three and a half seconds, quickly at first
// and slower with each hop, like a wheel running out of momentum.
const HOPS = 26;
const FIRST_HOP_MS = 55;
const LAST_HOP_MS = 330;

function hopDelay(hop: number): number {
  const progress = hop / HOPS;
  return FIRST_HOP_MS + (LAST_HOP_MS - FIRST_HOP_MS) * progress * progress;
}

// Fewest games a library needs before rolling for a random one is offered.
export const MIN_RANDOM_GAMES = 3;

// A dice roll over a list of choices. While it rolls, `rolled` hops from one choice to
// another, so the page can light each one up in turn. It then rests on the pick.
// `valid` is every choice that may be shown as rolled.
export function useDiceRoll<T>(valid: T[]) {
  const [rolled, setRolled] = useState<T | null>(null);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the roll in progress will end, so it can be skipped to.
  const ending = useRef<T | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Hops around `pool`, then rests on `target`. Without a target, the resting place is random.
  function roll(pool: T[], target?: T) {
    if (pool.length === 0) return;
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    const final = target ?? pick();

    if (timer.current) clearTimeout(timer.current);
    ending.current = final;

    // No hopping for players who have asked their device for less motion.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRolled(final);
      return;
    }

    setRolling(true);
    let hops = 0;

    const hop = () => {
      hops += 1;

      if (hops < HOPS) {
        setRolled(pick());
        timer.current = setTimeout(hop, hopDelay(hops));
      } else {
        setRolled(final);
        setRolling(false);
      }
    };

    hop();
  }

  // Jumps a roll in progress straight to where it was going to end.
  function skip() {
    if (!rolling || ending.current === null) return;
    if (timer.current) clearTimeout(timer.current);

    setRolled(ending.current);
    setRolling(false);
  }

  return {
    // A pick left over from an earlier list of choices no longer counts.
    rolled: rolled !== null && valid.includes(rolled) ? rolled : null,
    rolling,
    roll,
    skip,
  };
}
