"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage, useApi, type GameSearchResult } from "@/lib/api";
import { genreLine } from "@/lib/genres";
import { PixelIcon } from "@/components/pixel-icons";
import { RowListSkeleton } from "@/components/skeletons";
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

const MIN_SEARCH_LENGTH = 2;
// A search returns up to 40 games. Eight fit on a laptop screen without much scrolling.
const PAGE_SIZE = 8;
// How long the player must stop typing before a search is sent. Short enough to feel live,
// long enough that one word is one request and not one per letter.
const TYPING_PAUSE_MS = 350;

export function AddGameView({ initialQuery = "" }: { initialQuery?: string }) {
  const api = useApi();
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [added, setAdded] = useState<Record<number, AddState>>({});
  const [sort, setSort] = useState<SortKey>("rating");
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  // Applies to every game added from this page until it is switched off.
  const [familyShared, setFamilyShared] = useState(false);
  const resultsTop = useRef<HTMLDivElement>(null);
  // The term most recently sent to the server.
  const latestTerm = useRef<string | null>(null);

  const results = useMemo(() => {
    if (search.status !== "results") return [];
    const { compare } = SORTS[sort];
    // Array sort is stable, so ties keep IGDB's best-match order.
    return compare ? [...search.games].sort(compare) : search.games;
  }, [search, sort]);

  // Results are shown a page at a time, so the list never runs far down the screen.
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const firstShown = (currentPage - 1) * PAGE_SIZE;
  const pageResults = results.slice(firstShown, firstShown + PAGE_SIZE);

  function goToPage(next: number) {
    setPage(next);
    // The next page starts at its top, not wherever the last one was scrolled to.
    resultsTop.current?.scrollIntoView({ block: "start" });
  }

  const runSearch = useCallback(
    async (term: string) => {
      // The same term twice in a row, such as pressing Enter after a pause, searches once.
      if (term === latestTerm.current) return;
      latestTerm.current = term;

      // Results already on screen stay there while the next ones load, so the list
      // does not flash empty on every keystroke.
      setSearching(true);
      setSearch((current) => (current.status === "results" ? current : { status: "loading" }));

      try {
        const games = await api<GameSearchResult[]>(
          `/api/catalog/search?q=${encodeURIComponent(term)}`,
        );
        // A slower, older search must not overwrite the results of a newer one.
        if (latestTerm.current === term) {
          setSearch({ status: "results", term, games });
          setPage(1);
        }
      } catch (error) {
        if (latestTerm.current === term) {
          setSearch({ status: "error", message: errorMessage(error) });
          // Lets the same term be tried again.
          latestTerm.current = null;
        }
      } finally {
        if (latestTerm.current === term || latestTerm.current === null) setSearching(false);
      }
    },
    [api],
  );

  // Search as the player types, once they pause.
  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_SEARCH_LENGTH) return;

    const timer = setTimeout(() => runSearch(term), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  function onQueryChange(value: string) {
    setQuery(value);

    // Too short to search: clear the old results so they do not sit under an unrelated query.
    if (value.trim().length < MIN_SEARCH_LENGTH) {
      latestTerm.current = null;
      setSearching(false);
      setSearch({ status: "idle" });
    }
  }

  // Pressing Enter searches straight away, without waiting for the pause.
  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();

    if (term.length < MIN_SEARCH_LENGTH) {
      setSearch({ status: "hint", message: "Type at least 2 characters to search." });
      return;
    }

    runSearch(term);
  }

  async function add(game: GameSearchResult) {
    setAdded((current) => ({ ...current, [game.igdbId]: "adding" }));

    try {
      await api("/api/library", { method: "POST", body: { igdbId: game.igdbId, familyShared } });
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
        {/* Results load as the player types. Pressing Enter searches without waiting. */}
        <div className="relative mt-3">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-pine"
          >
            <PixelIcon name="search" className="size-5" />
          </span>
          <input
            id="game-search"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Hades"
            autoComplete="off"
            maxLength={100}
            className="min-h-11 w-full min-w-0 bg-surface pr-3 pl-11 text-forest pixel-frame placeholder:text-muted/70"
          />
        </div>
      </form>

      <label className="mt-5 flex min-h-11 w-fit cursor-pointer items-center gap-3 px-1">
        <input
          type="checkbox"
          checked={familyShared}
          onChange={(event) => setFamilyShared(event.target.checked)}
          className="size-5 shrink-0 cursor-pointer accent-emerald"
        />
        <span>
          <span className="font-semibold text-forest">From Steam Family</span>
          <span className="block text-sm text-muted">
            Tag the games you add next as shared through Steam Family. They still count as yours.
          </span>
        </span>
      </label>

      <p className="mt-2 px-1 text-muted">
        Have a Steam library?{" "}
        <Link
          href="/library/import"
          className="inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4 hover:no-underline"
        >
          Import from Steam
        </Link>
      </p>

      <div ref={resultsTop} className="mt-8 scroll-mt-6" aria-live="polite">
        {search.status === "hint" && <Notice tone="info">{search.message}</Notice>}

        {/* First search: placeholder rows. Later ones: a small note above the current results. */}
        {search.status === "loading" && <RowListSkeleton label="Searching" count={5} />}
        {searching && search.status === "results" && <PixelLoader label="Searching" />}

        {search.status === "error" && <Notice tone="error">{search.message}</Notice>}

        {search.status === "results" && search.games.length === 0 && (
          <Notice tone="info">
            No games found for &quot;{search.term}&quot;. Check the spelling or try a shorter
            title.
          </Notice>
        )}

        {search.status === "results" && search.games.length > 1 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">
              {pageCount > 1
                ? `Showing ${firstShown + 1} to ${firstShown + pageResults.length} of ${search.games.length} games`
                : `${search.games.length} games found`}
            </p>
            <label className="flex items-center gap-3">
              <span className="pixel-label text-muted">Sort by</span>
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as SortKey);
                  // A new order starts from its first page.
                  setPage(1);
                }}
                className="pixel-select min-h-11 cursor-pointer bg-surface pl-3 font-semibold text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
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
          <ul
            // Dimmed while a newer search is running, to show these are about to be replaced.
            className={`space-y-5 px-1 transition-opacity duration-200 ${
              searching ? "opacity-50" : ""
            }`}
          >
            {pageResults.map((game) => {
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

        {search.status === "results" && pageCount > 1 && (
          <nav
            aria-label="Search result pages"
            className="mt-8 flex items-center justify-between gap-4 px-1 pb-2"
          >
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="btn btn-secondary"
            >
              Previous
            </button>
            <p className="text-center font-semibold text-forest">
              Page {currentPage} of {pageCount}
            </p>
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === pageCount}
              className="btn btn-secondary"
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
