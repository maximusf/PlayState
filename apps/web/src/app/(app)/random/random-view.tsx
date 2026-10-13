"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, useApi, type LibraryEntry } from "@/lib/api";
import { genreLine } from "@/lib/genres";
import { MIN_RANDOM_GAMES } from "@/lib/use-dice-roll";
import { PixelIcon } from "@/components/pixel-icons";
import { WinnerTrace } from "@/components/winner-trace";
import { EmptyState, GameCover, Notice } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: LibraryEntry[] };

// The reel is a row of covers that slides left and slows to a stop on the pick.
const TILE = 96;
const GAP = 12;
const STEP = TILE + GAP;
// How many covers pass before the pick, and how many trail after it so the row never runs out.
const LEAD = 26;
const TRAIL = 6;
// The cover under the marker before a spin. Far enough in that covers fill the row to its left.
const START = 4;
const SPIN_MS = 3400;

function sample(entries: LibraryEntry[]): LibraryEntry {
  return entries[Math.floor(Math.random() * entries.length)];
}

function shuffled(entries: LibraryEntry[]): LibraryEntry[] {
  const deck = [...entries];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Fills the reel the way a deck of cards is dealt: every game appears once before any game
// comes round again, so the same cover is never seen twice at once unless the library is
// smaller than the window. The winner is left out of the deck and placed only where the
// reel stops, so it appears exactly once.
function dealReel(entries: LibraryEntry[], winner: LibraryEntry | null): LibraryEntry[] {
  const others = winner ? entries.filter((entry) => entry.id !== winner.id) : entries;
  const pool = others.length > 0 ? others : entries;
  const reel: LibraryEntry[] = [];

  // About this many covers fit in the window at once. A game dealt at the end of one deck
  // is held back in the next, so it cannot turn up again while it is still on screen.
  const apart = Math.min(8, Math.floor(pool.length / 2));

  while (reel.length < LEAD + TRAIL + 1) {
    const recent = new Set(reel.slice(reel.length - apart).map((entry) => entry.id));
    const deck = shuffled(pool);
    reel.push(
      ...deck.filter((entry) => !recent.has(entry.id)),
      ...deck.filter((entry) => recent.has(entry.id)),
    );
  }

  reel.length = LEAD + TRAIL + 1;
  if (winner) reel[LEAD] = winner;

  return reel;
}

// Chooses where a spin will land and deals the reel for it. A spin never lands on the game
// the last one showed.
function dealSpin(entries: LibraryEntry[], last: LibraryEntry | null) {
  const pool = last ? entries.filter((entry) => entry.id !== last.id) : entries;
  const winner = sample(pool.length > 0 ? pool : entries);

  return { reel: dealReel(entries, winner), winner };
}

export function RandomView() {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reel, setReel] = useState<LibraryEntry[]>([]);
  // Which cover sits under the marker, and whether the slide to it is animated.
  const [position, setPosition] = useState(START);
  const [animate, setAnimate] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [picked, setPicked] = useState<LibraryEntry | null>(null);
  // The next spin, dealt ahead of time so its covers are downloaded before they are needed.
  const upcoming = useRef<{ reel: LibraryEntry[]; winner: LibraryEntry } | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<LibraryEntry[]>("/api/library").then(
      (entries) => {
        if (cancelled) return;
        setState({ status: "ready", entries });
        // A still reel to look at before the first spin.
        if (entries.length > 0) setReel(dealReel(entries, null));
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api]);

  const entries = useMemo(() => (state.status === "ready" ? state.entries : []), [state]);
  const enough = entries.length >= MIN_RANDOM_GAMES;

  // Decides the next spin as soon as the page is ready, and again after each result, then
  // fetches every cover on that reel. Covers used to arrive mid-spin and show as blank cards.
  useEffect(() => {
    if (!enough || spinning) return;

    upcoming.current = dealSpin(entries, picked);
    for (const entry of upcoming.current.reel) {
      if (entry.game.coverUrl) new window.Image().src = entry.game.coverUrl;
    }
  }, [entries, enough, picked, spinning]);

  function spin() {
    const { reel: next, winner } = upcoming.current ?? dealSpin(entries, picked);
    upcoming.current = null;

    setReel(next);
    setPicked(null);

    // Players who have asked for less motion get the result with no spin.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimate(false);
      setPosition(LEAD);
      setPicked(winner);
      return;
    }

    // Snap back to the start, then slide to the pick on the next frame so the move is animated.
    setSpinning(true);
    setAnimate(false);
    setPosition(START);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setAnimate(true);
        setPosition(LEAD);
      }),
    );
  }

  // Pressing the button again mid-spin jumps the reel to where it was going to stop.
  function skip() {
    setAnimate(false);
    setSpinning(false);
    setPicked(reel[LEAD] ?? null);
  }

  function onStopped(event: React.TransitionEvent<HTMLDivElement>) {
    // The covers inside have fades of their own. Only the reel's own slide ending counts.
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    if (!spinning) return;
    setSpinning(false);
    setPicked(reel[LEAD] ?? null);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/library"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-forest underline underline-offset-4 hover:no-underline"
      >
        Back to your library
      </Link>
      <h1 className="mt-2 font-pixel text-6xl leading-[0.9] text-forest">Random game</h1>
      <p className="mt-4 text-lg text-slate">
        No questions. Spin, and play whatever your library lands on.
      </p>

      <div className="mt-8">
        {state.status === "loading" && (
          <div role="status" aria-busy="true" className="mx-1 h-40 animate-pulse bg-fern/40 pixel-frame">
            <span className="sr-only">Loading your library</span>
          </div>
        )}

        {state.status === "error" && <Notice tone="error">{state.message}</Notice>}

        {state.status === "ready" && !enough && (
          <div className="px-1">
            <EmptyState
              title="Not enough games to spin."
              action={
                <Link href="/library/add" className="btn btn-primary mb-2">
                  Add a game
                </Link>
              }
            >
              A spin needs at least {MIN_RANDOM_GAMES} games to choose from. You have{" "}
              {entries.length}.
            </EmptyState>
          </div>
        )}

        {state.status === "ready" && enough && (
          <>
            <div
              aria-hidden="true"
              className="relative mx-1 overflow-hidden bg-surface py-4 pixel-frame"
            >
              <div
                onTransitionEnd={onStopped}
                className="flex"
                style={{
                  gap: GAP,
                  // The row starts at the middle of the window, then shifts back by the distance
                  // to the middle of the cover under the marker.
                  marginLeft: "50%",
                  transform: `translateX(${-(position * STEP + TILE / 2)}px)`,
                  transition: animate
                    ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.72, 0.18, 1)`
                    : "none",
                }}
              >
                {reel.map((entry, index) => {
                  const landed = picked !== null && index === LEAD;

                  return (
                    <div key={index} className="shrink-0" style={{ width: TILE }}>
                      <GameCover
                        title={entry.game.title}
                        coverUrl={entry.game.coverUrl}
                        eager
                        className={`transition duration-200 ease-out ${
                          landed ? "" : "opacity-35 grayscale"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              {/* The marker the pick stops under. */}
              <div
                className={`pointer-events-none absolute inset-y-2 left-1/2 -translate-x-1/2 ring-4 ${
                  picked ? "ring-transparent" : "ring-emerald"
                }`}
                style={{ width: TILE + 8 }}
              >
                {picked && <WinnerTrace />}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-5 px-1 pb-3">
              <button
                type="button"
                onClick={spinning ? skip : spin}
                className="btn btn-primary btn-lg"
              >
                <PixelIcon name="dice" className="size-6" />
                {spinning ? "Skip" : picked ? "Spin again" : "Spin"}
              </button>
              <p className="text-muted">Choosing from {entries.length} games.</p>
            </div>

            <div role="status" className="mt-6">
              {picked && (
                <div className="mx-1 flex flex-wrap items-center gap-5 bg-surface p-5 pixel-frame">
                  <GameCover
                    title={picked.game.title}
                    coverUrl={picked.game.coverUrl}
                    className="w-28 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="pixel-label text-pine">Tonight you play</p>
                    <h2 className="mt-2 font-pixel text-5xl leading-[0.9] text-forest">
                      {picked.game.title}
                    </h2>
                    <p className="mt-2 text-muted">
                      {genreLine(picked.game.genres, 3)}
                      {picked.game.timeToBeatHours !== null && (
                        <> | About {picked.game.timeToBeatHours} hrs to finish</>
                      )}
                    </p>
                    <div className="mt-4 px-1 pb-1">
                      <Link href={`/library/${picked.id}`} className="btn btn-secondary">
                        View game
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
