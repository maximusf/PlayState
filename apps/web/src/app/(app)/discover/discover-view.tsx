"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, errorMessage, useApi } from "@/lib/api";
import { genreLine } from "@/lib/genres";
import { DiscoverSkeleton } from "@/components/skeletons";
import { EmptyState, GameCover, Notice } from "@/components/ui";

type DiscoverGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
  rating: number | null;
  ratingCount: number;
  reason: string;
};

type DiscoverResult = { games: DiscoverGame[]; libraryCount: number };

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: DiscoverResult };

// Per-card outcome of pressing Add.
type AddState = "adding" | "added" | "duplicate" | { error: string };

// Both choices live only in this browser. Storage can be blocked, so every access is guarded.
const DISMISSED_KEY = "playstate:discover:dismissed";
const MATURE_KEY = "playstate:discover:mature";

function readDismissed(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: number[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // The choice still holds for this visit.
  }
}

function readMature(): boolean {
  try {
    return localStorage.getItem(MATURE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMature(on: boolean) {
  try {
    if (on) localStorage.setItem(MATURE_KEY, "1");
    else localStorage.removeItem(MATURE_KEY);
  } catch {
    // The choice still holds for this visit.
  }
}

export function DiscoverView() {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [added, setAdded] = useState<Record<number, AddState>>({});
  // Null until the saved choice has been read, so the first request already uses it.
  const [mature, setMature] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Bumped by Try again to send the request once more.
  const [attempt, setAttempt] = useState(0);

  // Local storage is not there when the page is built on the server, so it is read after mount.
  useEffect(() => {
    Promise.resolve().then(() => {
      setDismissed(readDismissed());
      setMature(readMature());
    });
  }, []);

  useEffect(() => {
    if (mature === null) return;
    let cancelled = false;

    // The server hides mature games unless it is told outright.
    api<DiscoverResult>(`/api/discover${mature ? "?mature=true" : ""}`).then(
      (result) => {
        if (!cancelled) setState({ status: "ready", result });
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api, mature, attempt]);

  function changeMature(on: boolean) {
    saveMature(on);
    setConfirming(false);
    setState({ status: "loading" });
    setMature(on);
  }

  function retry() {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }

  function dismiss(igdbId: number) {
    const next = [...new Set([...dismissed, igdbId])];
    setDismissed(next);
    saveDismissed(next);
  }

  function showDismissedAgain() {
    setDismissed([]);
    saveDismissed([]);
  }

  async function add(game: DiscoverGame) {
    setAdded((current) => ({ ...current, [game.igdbId]: "adding" }));

    try {
      await api("/api/library", { method: "POST", body: { igdbId: game.igdbId } });
      setAdded((current) => ({ ...current, [game.igdbId]: "added" }));
    } catch (error) {
      const outcome: AddState =
        error instanceof ApiError && error.code === "GAME_ALREADY_ADDED"
          ? "duplicate"
          : { error: errorMessage(error) };
      setAdded((current) => ({ ...current, [game.igdbId]: outcome }));
    }
  }

  // Games the player has just added stay on screen as "Added", so the page does not jump.
  const games =
    state.status === "ready"
      ? state.result.games.filter((game) => !dismissed.includes(game.igdbId))
      : [];

  return (
    <div>
      <h1 className="font-pixel text-6xl leading-[0.9] text-forest">Discover</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Well rated Steam games that fit what you play and that fewer people have found. Nothing
        here is in your library already.
      </p>

      <section aria-label="Content settings" className="mt-6 px-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            role="switch"
            aria-checked={mature === true}
            onClick={() => (mature ? changeMature(false) : setConfirming(true))}
            className="btn btn-secondary"
          >
            Show mature content: {mature ? "On" : "Off"}
          </button>
          {!mature && !confirming && (
            <span className="text-sm text-muted">Games with sexual content are hidden.</span>
          )}
        </div>

        {confirming && (
          <div role="group" aria-label="Confirm your age" className="mt-4 bg-surface p-4 pixel-frame">
            <p className="font-semibold text-forest">Mature content can include sexual themes.</p>
            <p className="mt-1 text-muted">
              Only turn this on if you are 18 or older. This browser will remember your choice.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => changeMature(true)} className="btn btn-primary">
                I&apos;m 18 or older
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="mt-8" aria-live="polite">
        {state.status === "loading" && <DiscoverSkeleton label="Finding games for you" />}

        {state.status === "error" && (
          <div className="space-y-4">
            <Notice tone="error">{state.message}</Notice>
            <button type="button" onClick={retry} className="btn btn-secondary">
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && state.result.libraryCount === 0 && (
          <EmptyState
            title="Nothing to go on yet."
            action={
              <Link href="/library/import" className="btn btn-primary">
                Import from Steam
              </Link>
            }
          >
            Discover suggests games based on the ones you own. Add a few games or import your Steam
            library first.
          </EmptyState>
        )}

        {state.status === "ready" &&
          state.result.libraryCount > 0 &&
          state.result.games.length === 0 && (
            <EmptyState
              title="No new finds."
              action={
                <Link href="/library/add" className="btn btn-primary">
                  Add a game
                </Link>
              }
            >
              Nothing new matched your library. Adding a few more games gives Discover more to work
              with.
            </EmptyState>
          )}

        {state.status === "ready" && state.result.games.length > 0 && games.length === 0 && (
          <EmptyState title="All caught up.">
            You have dismissed every suggestion for now.
          </EmptyState>
        )}

        {games.length > 0 && (
          <ul className="grid gap-6 px-1 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) => {
              const status = added[game.igdbId];
              const done = status === "added" || status === "duplicate";

              return (
                <li key={game.igdbId} className="flex gap-4 bg-surface p-4 pixel-frame">
                  <GameCover title={game.title} coverUrl={game.coverUrl} className="w-24 shrink-0 self-start" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h2 className="font-semibold leading-snug text-forest">
                      {game.title}
                      {game.releaseYear && (
                        <span className="font-normal text-muted"> ({game.releaseYear})</span>
                      )}
                    </h2>
                    <p className="truncate text-sm text-muted">{genreLine(game.genres, 3)}</p>
                    <p className="mt-2 text-sm font-semibold text-pine">{game.reason}</p>
                    {game.rating !== null && (
                      <p className="text-sm text-muted">
                        Rated {game.rating} of 100 by {game.ratingCount} players
                      </p>
                    )}

                    {status === "duplicate" && (
                      <p role="status" className="mt-2 text-sm font-semibold text-forest">
                        Already in your library.
                      </p>
                    )}
                    {typeof status === "object" && (
                      <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                        {status.error}
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap gap-2 pt-3">
                      <button
                        type="button"
                        onClick={() => add(game)}
                        disabled={done || status === "adding"}
                        aria-label={
                          status === "added"
                            ? `${game.title} added to your library`
                            : `Add ${game.title} to your library`
                        }
                        className="btn btn-primary px-4"
                      >
                        {status === "adding" ? "Adding" : done ? "Added" : "Add to library"}
                      </button>
                      {!done && (
                        <button
                          type="button"
                          onClick={() => dismiss(game.igdbId)}
                          aria-label={`Not interested in ${game.title}`}
                          className="btn btn-secondary px-4"
                        >
                          Not interested
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {dismissed.length > 0 && state.status === "ready" && (
          <p className="mt-8 px-1 text-muted">
            {dismissed.length} {dismissed.length === 1 ? "game" : "games"} hidden.{" "}
            <button
              type="button"
              onClick={showDismissedAgain}
              className="inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4 hover:no-underline"
            >
              Show them again
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
