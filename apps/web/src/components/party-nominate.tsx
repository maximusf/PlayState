"use client";

import { useState } from "react";
import { errorMessage, useApi, type PartyDetail, type PartyNominations } from "@/lib/api";

// How many games one member can have nominated at a time. The server enforces the same number.
export const MAX_NOMINATIONS = 2;

// A pixel star, drawn here so the badge does not depend on the shared icon set.
const STAR = [
  "....##....",
  "....##....",
  "...####...",
  "##########",
  ".########.",
  "..######..",
  "..######..",
  ".###..###.",
  ".##....##.",
];

const STAR_PATH = STAR.flatMap((row, y) =>
  [...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1H${run.index}z`),
).join("");

function Star({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 9"
      className={`fill-current ${className}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

type Nomination = PartyDetail["nominations"][number];

// Everything the nominations UI needs, worked out once for the party page.
export function useNominations({
  party,
  path,
  onChanged,
}: {
  party: PartyDetail;
  path: string;
  onChanged: (changes: PartyNominations) => void;
}) {
  const api = useApi();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The host's choice, kept on their own page. It only lasts until the next roll.
  const [rollFromAll, setRollFromAll] = useState(false);

  const you = party.members.find((member) => member.isYou);
  const nominations = party.nominations;
  const mine = nominations.filter((nomination) => nomination.memberId === you?.id);
  const nominatedIds = new Set(nominations.map((nomination) => nomination.igdbId));

  async function toggle(igdbId: number) {
    const remove = mine.some((nomination) => nomination.igdbId === igdbId);

    setPendingId(igdbId);
    setError(null);

    try {
      onChanged(
        await api<PartyNominations>(
          remove ? `${path}/nominations/${igdbId}` : `${path}/nominations`,
          remove ? { method: "DELETE" } : { method: "POST", body: { igdbId } },
        ),
      );
    } catch (caught) {
      setError(`Your nomination was not saved. ${errorMessage(caught)}`);
    } finally {
      setPendingId(null);
    }
  }

  // Two or more nominated games become the pool the host rolls from, unless they opt out.
  const nominatedCount = nominatedIds.size;
  const nominatedOnly = nominatedCount >= 2 && !rollFromAll;

  return {
    nominations,
    youId: you?.id,
    mine,
    nominatedIds,
    nominatedCount,
    nominatedOnly,
    rollFromAll,
    setRollFromAll,
    atLimit: mine.length >= MAX_NOMINATIONS,
    pendingId,
    error,
    toggle,
    // The games the next roll may land on.
    pool: (playableIds: number[]) =>
      nominatedOnly ? playableIds.filter((igdbId) => nominatedIds.has(igdbId)) : playableIds,
  };
}

export type Nominations = ReturnType<typeof useNominations>;

// A star in each other member's colour, shown on the cover of every game they put forward. The
// viewer's own nominations show as the yellow star in the corner instead.
export function NominatedBadge({
  nominators,
  colours,
}: {
  nominators: Nomination[];
  colours: Map<string, string>;
}) {
  if (nominators.length === 0) return null;

  return (
    <span className="absolute right-1 top-1 flex flex-wrap justify-end gap-1">
      {nominators.map((nomination) => (
        <span
          key={nomination.memberId}
          className="inline-flex size-6 items-center justify-center bg-surface ring-2 ring-forest"
          style={{ color: colours.get(nomination.memberId) }}
        >
          <Star />
        </span>
      ))}
    </span>
  );
}

// A star in a game's top left corner. It shows on hover or focus, and turns yellow and stays once
// the member has nominated the game. It says why it is off when the member is at their limit.
export function NominateStar({
  igdbId,
  title,
  nominations,
  disabled = false,
}: {
  igdbId: number;
  title: string;
  nominations: Nominations;
  disabled?: boolean;
}) {
  const nominated = nominations.mine.some((nomination) => nomination.igdbId === igdbId);
  const blocked = !nominated && nominations.atLimit;
  const reason = blocked
    ? `You have nominated ${MAX_NOMINATIONS} games. Remove one to nominate another.`
    : null;

  return (
    <button
      type="button"
      aria-pressed={nominated}
      aria-label={`${nominated ? "Remove your nomination for" : "Nominate"} ${title}`}
      title={reason ?? (nominated ? "Nominated" : "Nominate")}
      disabled={disabled || blocked || nominations.pendingId !== null}
      onClick={() => nominations.toggle(igdbId)}
      className={`absolute left-1 top-1 flex size-9 cursor-pointer items-center justify-center transition-opacity hover:bg-forest/70 focus-visible:opacity-100 disabled:cursor-not-allowed [@media(hover:none)]:opacity-100 ${
        nominated
          ? "bg-forest/70 text-[#facc15] opacity-100"
          : "bg-forest/40 text-surface/80 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      }`}
    >
      <Star className="size-5" />
    </button>
  );
}

// Next to the host's dice button: what the next roll will pick from, and the way to widen it.
export function RollSourceNote({ nominations }: { nominations: Nominations }) {
  if (nominations.nominatedCount < 2) return null;

  const count = nominations.nominatedCount;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2">
      <p role="status" className="font-semibold text-forest">
        {nominations.rollFromAll
          ? "Rolling from everything"
          : `Rolling from ${count} nominated games`}
      </p>
      <button
        type="button"
        onClick={() => nominations.setRollFromAll(!nominations.rollFromAll)}
        aria-pressed={nominations.rollFromAll}
        className="min-h-11 cursor-pointer font-semibold text-forest underline underline-offset-4 hover:no-underline"
      >
        {nominations.rollFromAll ? "Roll from nominated games" : "Roll from everything instead"}
      </button>
    </div>
  );
}
