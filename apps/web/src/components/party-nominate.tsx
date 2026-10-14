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

// A star in the member's colour, shown on the cover of every game they put forward.
export function NominatedBadge({
  nominators,
  colours,
}: {
  nominators: Nomination[];
  colours: Map<string, string>;
}) {
  if (nominators.length === 0) return null;

  return (
    <span className="absolute left-1 top-1 flex flex-wrap gap-1">
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

// The Nominate button under a game tile. It says why it is off when the member is at their limit.
export function NominateButton({
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
  const pending = nominations.pendingId === igdbId;

  return (
    <>
      <button
        type="button"
        aria-pressed={nominated}
        aria-label={`${nominated ? "Remove your nomination for" : "Nominate"} ${title}`}
        aria-describedby={reason ? `nominate-reason-${igdbId}` : undefined}
        title={reason ?? undefined}
        disabled={disabled || blocked || nominations.pendingId !== null}
        onClick={() => nominations.toggle(igdbId)}
        className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 px-2 text-sm font-bold ring-2 ring-forest ring-inset hover:bg-mint disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${
          nominated ? "bg-mint text-forest" : "bg-surface text-forest"
        }`}
      >
        <Star className="size-4" />
        {pending ? "Saving" : nominated ? "Nominated" : "Nominate"}
      </button>
      {reason && (
        <span id={`nominate-reason-${igdbId}`} className="block text-xs text-muted">
          {reason}
        </span>
      )}
    </>
  );
}

// Who nominated what, in a line above the tiles. Also tells the party how the roll will work.
export function NominationStrip({
  nominations,
  members,
  games,
  colours,
  isHost,
}: {
  nominations: Nominations;
  members: PartyDetail["members"];
  games: { igdbId: number; title: string }[];
  colours: Map<string, string>;
  isHost: boolean;
}) {
  const titles = new Map(games.map((game) => [game.igdbId, game.title]));
  const names = new Map(members.map((member) => [member.id, member.displayName]));

  return (
    <div className="mx-1 mt-5 bg-surface p-4 pixel-frame [--frame:var(--color-fern)]">
      <p className="pixel-label flex items-center gap-2 text-pine">
        <Star className="size-4" />
        Nominations
      </p>

      {nominations.nominations.length === 0 ? (
        <p className="mt-2 text-muted">
          Nominate up to {MAX_NOMINATIONS} games you would like to play. With two or more
          nominated, the host&apos;s dice rolls from those.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {nominations.nominations.map((nomination) => (
            <li
              key={`${nomination.memberId}-${nomination.igdbId}`}
              className="flex min-h-9 items-center gap-2 bg-mint px-2 text-sm font-semibold text-forest"
            >
              <span style={{ color: colours.get(nomination.memberId) }} className="bg-surface p-1">
                <Star className="size-3" />
              </span>
              <span>
                {titles.get(nomination.igdbId) ?? "A game"}
                <span className="font-normal text-muted">
                  {" "}
                  by {names.get(nomination.memberId) ?? "a player"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {nominations.nominations.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          {isHost
            ? nominations.nominatedCount >= 2
              ? "Nominations clear after each roll."
              : "Add one more nominated game and your roll will come from the nominated games."
            : nominations.nominatedCount >= 2
              ? "The host rolls from the nominated games. Nominations clear after each roll."
              : "The host rolls from everything until two games are nominated."}
        </p>
      )}
    </div>
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
