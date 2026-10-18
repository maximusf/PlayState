"use client";

import { useState } from "react";
import { CardsRoll } from "@/components/roll-cards";
import { CarouselRoll } from "@/components/roll-carousel";
import { CoverDieRoll } from "@/components/roll-cover-die";
import { SlotsRoll } from "@/components/roll-slots";
import { pickContenders, type RollGame } from "@/lib/roll-games";
import { rollStyleMs, type RollStyleId } from "@/lib/party-roll-styles";

// How many games each animation shows at most. The picked game is always one of them.
const LIMITS: Record<Exclude<RollStyleId, "classic">, number> = {
  "cover-die": 6,
  carousel: 12,
  "triple-slot": 8,
  "card-shuffle": 8,
};

// The host's chosen roll animation, played the same way in every member's browser. `games` is
// everything the roll could land on, and `seed` is the same for everyone, so every browser deals
// the same covers in the same places. The classic die is not drawn here, because it is plain CSS.
export function RollStage({
  style,
  games,
  winnerId,
  seed,
  delayMs,
}: {
  style: RollStyleId;
  games: RollGame[];
  winnerId: number;
  seed: number;
  delayMs: number;
}) {
  // Dealt once, so a change to the party's games part way through a roll cannot reshuffle it.
  const [deal] = useState(() => (style === "classic" ? null : pickContenders(games, winnerId, LIMITS[style], seed)));

  if (!deal || style === "classic") return null;

  const props = { games: deal.list, winner: deal.winner, seed, delayMs, durationMs: rollStyleMs(style) };

  switch (style) {
    case "cover-die":
      return <CoverDieRoll {...props} />;
    case "carousel":
      return <CarouselRoll {...props} />;
    case "triple-slot":
      return <SlotsRoll {...props} />;
    case "card-shuffle":
      return <CardsRoll {...props} />;
  }
}
