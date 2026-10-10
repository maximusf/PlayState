"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { errorMessage, useApi, type LibraryEntry } from "@/lib/api";
import { genreLine, shortGenre } from "@/lib/genres";
import { EmptyState, GameCover, Notice, PixelLoader } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: LibraryEntry[] };

// How many genre filters to offer. More than this wraps badly on a phone.
const MAX_FILTERS = 6;

const filterChip =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-[0.9375rem] font-semibold";

export function LibraryView() {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [genre, setGenre] = useState<string | null>(null);

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

  const entries = useMemo(() => (state.status === "ready" ? state.entries : []), [state]);

  // The most common genres in this library, with how many games carry each.
  const filters = useMemo(() => {
    const counts = new Map<string, number>();

    for (const entry of entries) {
      for (const name of new Set(entry.game.genres.map(shortGenre))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }

    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_FILTERS);
  }, [entries]);

  const visible = genre
    ? entries.filter((entry) => entry.game.genres.some((name) => shortGenre(name) === genre))
    : entries;
  const count = entries.length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-pixel text-6xl leading-[0.9] text-forest">Your library</h1>
          {count > 0 && (
            <p className="mt-2 text-lg text-muted">
              {count} {count === 1 ? "game" : "games"}
            </p>
          )}
        </div>
        {count > 0 && (
          <div className="flex flex-wrap gap-5 px-1 pb-3">
            <Link href="/library/add" className="btn btn-secondary">
              Add a game
            </Link>
            <Link href="/pick" className="btn btn-primary">
              Pick a game
            </Link>
          </div>
        )}
      </div>

      {count > 1 && filters.length > 1 && (
        <div
          role="group"
          aria-label="Filter by genre"
          className="mt-7 flex flex-wrap items-center gap-2.5 border-y-4 border-dotted border-fern py-4"
        >
          <span className="pixel-label mr-1 text-muted">Show</span>
          <button
            type="button"
            aria-pressed={genre === null}
            onClick={() => setGenre(null)}
            className={`${filterChip} ${
              genre === null
                ? "bg-forest text-surface"
                : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
            }`}
          >
            All {count}
          </button>
          {filters.map(([name, total]) => (
            <button
              key={name}
              type="button"
              aria-pressed={genre === name}
              onClick={() => setGenre(genre === name ? null : name)}
              className={`${filterChip} ${
                genre === name
                  ? "bg-forest text-surface"
                  : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
              }`}
            >
              {name} {total}
            </button>
          ))}
        </div>
      )}

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

        {state.status === "ready" && count === 0 && (
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

        {count > 0 && (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-8 px-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visible.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/library/${entry.id}`}
                  className="group flex flex-col gap-3 outline-offset-8"
                >
                  <span className="relative block ring-4 ring-forest group-hover:ring-emerald group-focus-visible:ring-emerald">
                    <GameCover title={entry.game.title} coverUrl={entry.game.coverUrl} />
                    <span
                      aria-hidden="true"
                      className="absolute bottom-3 left-3 hidden bg-forest px-2.5 py-1.5 text-sm font-bold text-surface group-hover:block group-focus-visible:block"
                    >
                      View details
                    </span>
                  </span>
                  <span>
                    <span className="block text-lg font-bold leading-snug text-forest">
                      {entry.game.title}
                    </span>
                    <span className="block text-sm text-muted">{genreLine(entry.game.genres)}</span>
                  </span>
                </Link>
              </li>
            ))}

            {genre === null && (
              <li>
                <Link href="/library/add" className="group flex flex-col gap-3 outline-offset-8">
                  <span className="flex aspect-[3/4] items-center justify-center bg-surface ring-4 ring-fern group-hover:ring-emerald group-focus-visible:ring-emerald">
                    <span aria-hidden="true" className="font-pixel text-7xl leading-none text-pine">
                      +
                    </span>
                  </span>
                  <span className="block text-lg font-bold leading-snug text-forest">Add a game</span>
                </Link>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
