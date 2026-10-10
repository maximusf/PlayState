"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessage, useApi, type LibraryEntry } from "@/lib/api";
import { EmptyState, GameCover, Notice, PixelLoader } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: LibraryEntry[] };

export function LibraryView() {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<LibraryEntry[]>("/api/library").then(
      (entries) => {
        if (!cancelled) setState({ status: "ready", entries });
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  function retry() {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  async function remove(entry: LibraryEntry) {
    setRemovingId(entry.id);
    setRemoveError(null);

    try {
      await api(`/api/library/${entry.id}`, { method: "DELETE" });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", entries: current.entries.filter((item) => item.id !== entry.id) }
          : current,
      );
    } catch (error) {
      setRemoveError(`${entry.game.title} was not removed. ${errorMessage(error)}`);
    } finally {
      setRemovingId(null);
    }
  }

  const count = state.status === "ready" ? state.entries.length : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <h1 className="font-pixel text-3xl text-forest">Your library</h1>
          {count > 0 && (
            <p className="mt-1 text-muted">
              {count} {count === 1 ? "game" : "games"}
            </p>
          )}
        </div>
        {count > 0 && (
          <div className="flex flex-wrap gap-5 pb-2">
            <Link href="/library/add" className="btn btn-secondary">
              Add a game
            </Link>
            <Link href="/pick" className="btn btn-primary">
              Pick a game
            </Link>
          </div>
        )}
      </div>

      <div className="mt-8">
        {state.status === "loading" && <PixelLoader label="Loading your library" />}

        {state.status === "error" && (
          <div className="space-y-4">
            <Notice tone="error">{state.message}</Notice>
            <button type="button" onClick={retry} className="btn btn-secondary mx-1">
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && state.entries.length === 0 && (
          <div className="px-1">
            <EmptyState
              title="Your library is empty."
              action={
                <Link href="/library/add" className="btn btn-primary mb-2">
                  Add a game
                </Link>
              }
            >
              Add a few games so PlayState can help you decide what to play.
            </EmptyState>
          </div>
        )}

        {removeError && (
          <div className="mb-6">
            <Notice tone="error">{removeError}</Notice>
          </div>
        )}

        {state.status === "ready" && state.entries.length > 0 && (
          <ul className="grid grid-cols-2 gap-x-5 gap-y-7 px-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {state.entries.map((entry) => (
              <li key={entry.id} className="flex flex-col bg-surface pixel-frame">
                <GameCover title={entry.game.title} coverUrl={entry.game.coverUrl} />
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <h2 className="font-semibold leading-snug text-forest">{entry.game.title}</h2>
                  <p className="text-sm text-muted">
                    {entry.game.genres.slice(0, 2).join(", ") || "No genre listed"}
                  </p>
                  <button
                    type="button"
                    onClick={() => remove(entry)}
                    disabled={removingId === entry.id}
                    aria-label={`Remove ${entry.game.title} from your library`}
                    className="mt-auto min-h-11 self-start pt-2 text-sm font-semibold text-danger underline underline-offset-4 hover:no-underline disabled:opacity-60"
                  >
                    {removingId === entry.id ? "Removing" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
