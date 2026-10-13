"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { MIN_RANDOM_GAMES } from "@/lib/use-dice-roll";
import { PixelIcon } from "./pixel-icons";

// A square dice button that opens the random game page. With too few games in the library
// it turns grey and leads to adding games instead.
// Pass `count` when the page already knows the library size. Otherwise it is looked up.
export function RandomDiceLink({ count, large = false }: { count?: number; large?: boolean }) {
  const api = useApi();
  const [fetched, setFetched] = useState<number | null>(null);

  useEffect(() => {
    if (count !== undefined) return;
    let cancelled = false;

    api<{ count: number }>("/api/library/count").then(
      (data) => {
        if (!cancelled) setFetched(data.count);
      },
      // If the count cannot be loaded the dice stays usable. The random page explains itself.
      () => {},
    );

    return () => {
      cancelled = true;
    };
  }, [api, count]);

  const known = count ?? fetched;
  const ready = known === null || known >= MIN_RANDOM_GAMES;
  const size = large ? "btn-lg w-[3.25rem]" : "w-11";
  const icon = <PixelIcon name="dice" className={large ? "size-9" : "size-6"} />;

  if (!ready) {
    const label = `Add at least ${MIN_RANDOM_GAMES} games to roll for a random one`;

    return (
      <Link
        href="/library/add"
        aria-label={label}
        title={label}
        className={`btn btn-secondary px-0 text-muted opacity-60 ${size}`}
      >
        {icon}
      </Link>
    );
  }

  return (
    <Link
      href="/random"
      aria-label="Roll for a random game"
      title="Roll for a random game"
      className={`btn btn-primary px-0 ${size}`}
    >
      {icon}
    </Link>
  );
}
