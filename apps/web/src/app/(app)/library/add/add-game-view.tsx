"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, errorMessage, useApi, type GameSearchResult } from "@/lib/api";
import { genreLine } from "@/lib/genres";
import { GameCover, Notice, PixelLoader } from "@/components/ui";

type SearchState =
  | { status: "idle" }
  | { status: "hint"; message: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "results"; term: string; games: GameSearchResult[] };

// Fewest ratings a game needs before its score is treated as reliable.
const MIN_RATINGS = 10;

function isTrusted(game: GameSearchResult): boolean {
  return game.rating !== null && game.ratingCount >= MIN_RATINGS;
}

// Sorting happens in the browser, on the results IGDB already returned.
// Games missing the sorted value always go last.
const SORTS = {
  rating: {
    label: "Highest rated",
    // A score from a handful of ratings is not reliable, so those games rank
    // below every game with enough ratings, whatever their score.
    compare: (a: GameSearchResult, b: GameSearchResult) =>
      Number(isTrusted(b)) - Number(isTrusted(a)) ||
      (b.rating ?? -1) - (a.rating ?? -1) ||
      b.ratingCount - a.ratingCount,
  },
  popular: {
    label: "Most rated",
    compare: (a: GameSearchResult, b: GameSearchResult) => b.ratingCount - a.ratingCount,
  },
  relevance: { label: "Closest title match", compare: null },
  newest: {
    label: "Newest",
    compare: (a: GameSearchResult, b: GameSearchResult) =>
      (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
  },
  oldest: {
    label: "Oldest",
    compare: (a: GameSearchResult, b: GameSearchResult) =>
      (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"),
  },
  title: {
    label: "Title A to Z",
    compare: (a: GameSearchResult, b: GameSearchResult) => a.title.localeCompare(b.title),
  },
} as const;

type SortKey = keyof typeof SORTS;

// Per-row outcome of pressing Add.
type AddState = "adding" | "added" | "duplicate" | { error: string };

export function AddGameView() {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [added, setAdded] = useState<Record<number, AddState>>({});
  const [sort, setSort] = useState<SortKey>("rating");

  const results = useMemo(() => {
    if (search.status !== "results") return [];
    const { compare } = SORTS[sort];
    // Array sort is stable, so ties keep IGDB's best-match order.
    return compare ? [...search.games].sort(compare) : search.games;
  }, [search, sort]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();

    if (term.length < 2) {
      setSearch({ status: "hint", message: "Type at least 2 characters to search." });
      return;
    }

    setSearch({ status: "loading" });

    try {
      const games = await api<GameSearchResult[]>(
        `/api/catalog/search?q=${encodeURIComponent(term)}`,
      );
      setSearch({ status: "results", term, games });
    } catch (error) {
      setSearch({ status: "error", message: errorMessage(error) });
    }
  }

  async function add(game: GameSearchResult) {
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

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/library"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-forest underline underline-offset-4 hover:no-underline"
      >
        Back to your library
      </Link>
      <h1 className="mt-2 font-pixel text-6xl leading-[0.9] text-forest">Add a game</h1>

      <form onSubmit={onSubmit} role="search" className="mt-6 px-1">
        <label htmlFor="game-search" className="pixel-label text-muted">
          Search by title
        </label>
        <div className="mt-3 flex gap-5">
          <input
            id="game-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Hades"
            autoComplete="off"
            maxLength={100}
            className="min-h-11 min-w-0 flex-1 bg-surface px-3 text-forest pixel-frame placeholder:text-muted/70"
          />
          <button
            type="submit"
            disabled={search.status === "loading"}
            className="btn btn-primary mb-2"
          >
            Search
          </button>
        </div>
      </form>

      <div className="mt-8" aria-live="polite">
        {search.status === "hint" && <Notice tone="info">{search.message}</Notice>}

        {search.status === "loading" && <PixelLoader label="Searching" />}

        {search.status === "error" && <Notice tone="error">{search.message}</Notice>}

        {search.status === "results" && search.games.length === 0 && (
          <Notice tone="info">
            No games found for &quot;{search.term}&quot;. Check the spelling or try a shorter
            title.
          </Notice>
        )}

        {search.status === "results" && search.games.length > 1 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">{search.games.length} games found</p>
            <label className="flex items-center gap-3">
              <span className="pixel-label text-muted">Sort by</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="min-h-11 cursor-pointer bg-surface px-3 font-semibold text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
              >
                {Object.entries(SORTS).map(([key, option]) => (
                  <option key={key} value={key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {search.status === "results" && search.games.length > 0 && (
          <ul className="space-y-5 px-1">
            {results.map((game) => {
              const state = added[game.igdbId];
              const done = state === "added" || state === "duplicate";

              return (
                <li key={game.igdbId} className="flex items-center gap-4 bg-surface p-3 pixel-frame">
                  <GameCover
                    title={game.title}
                    coverUrl={game.coverUrl}
                    className="w-14 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-snug text-forest">
                      {game.title}
                      {game.releaseYear && (
                        <span className="font-normal text-muted"> ({game.releaseYear})</span>
                      )}
                    </h2>
                    <p className="truncate text-sm text-muted">
                      {genreLine(game.genres, 3)}
                      {game.rating !== null && (
                        <span>
                          {" | "}Rated {game.rating} of 100
                        </span>
                      )}
                    </p>
                    {state === "duplicate" && (
                      <p role="status" className="mt-1 text-sm font-semibold text-forest">
                        Already in your library.
                      </p>
                    )}
                    {typeof state === "object" && (
                      <p role="alert" className="mt-1 text-sm font-semibold text-danger">
                        {state.error}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => add(game)}
                    disabled={done || state === "adding"}
                    aria-label={
                      state === "added"
                        ? `${game.title} added to your library`
                        : `Add ${game.title} to your library`
                    }
                    className="btn btn-secondary shrink-0 px-4"
                  >
                    {state === "adding" ? "Adding" : done ? "Added" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
