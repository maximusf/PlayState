"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { errorMessage, useApi, type LibraryEntry } from "@/lib/api";
import { genreLine, shortGenre } from "@/lib/genres";
import { PixelIcon, type PixelIconName } from "@/components/pixel-icons";
import { CoverGridSkeleton, RowListSkeleton } from "@/components/skeletons";
import { EmptyState, GameCover, Notice } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: LibraryEntry[] };

// How many genre filters to offer. More than this wraps badly on a phone.
const MAX_FILTERS = 6;

// A hovered or focused cover eases upward off the page onto a hard pixel shadow.
const coverLift =
  "transition duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_8px_0_0_var(--color-forest)] group-focus-visible:-translate-y-1 group-focus-visible:shadow-[0_8px_0_0_var(--color-forest)]";

const filterChip =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-[0.9375rem] font-semibold";

const LAYOUTS = [
  { key: "grid", label: "Large covers", icon: "grid" },
  { key: "compact", label: "Small covers", icon: "compactGrid" },
  { key: "list", label: "List", icon: "list" },
] as const satisfies readonly { key: string; label: string; icon: PixelIconName }[];

type Layout = (typeof LAYOUTS)[number]["key"];

// The chosen layout is remembered in this browser.
const LAYOUT_KEY = "playstate.libraryLayout";
const LAYOUT_EVENT = "playstate:library-layout";

function readLayout(): Layout {
  try {
    const stored = window.localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.find((layout) => layout.key === stored)?.key ?? "grid";
  } catch {
    // Storage can be blocked, for example in a private window.
    return "grid";
  }
}

function subscribeToLayout(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(LAYOUT_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LAYOUT_EVENT, onChange);
  };
}

function saveLayout(layout: Layout) {
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // The layout still changes for this visit through the event below.
  }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

const SESSION_LABELS = { SHORT: "Under an hour", MEDIUM: "1 to 2 hours", LONG: "2+ hours" };

// The details shown beside a game in the list layout.
function listDetails(entry: LibraryEntry): string {
  const { releaseDate, timeToBeatHours } = entry.game;

  return [
    releaseDate?.slice(0, 4),
    timeToBeatHours === null ? null : `${timeToBeatHours} hr to finish`,
    entry.sessionLength && `You play ${SESSION_LABELS[entry.sessionLength].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

// With fewer games than this, the first Add a game tile is still in view at the end
// of the grid, and a second one right beside it would look like a mistake.
const TAIL_TILE_MIN_GAMES = 10;

function AddGameTile() {
  return (
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
  );
}

type Sort = {
  label: string;
  // Sorts low to high. The direction button reverses it.
  compare: (a: LibraryEntry, b: LibraryEntry) => number;
  // Games without the sorted value go last in both directions.
  missing: (entry: LibraryEntry) => boolean;
  // What each direction means, and the direction a sort starts in.
  ascending: string;
  descending: string;
  startsDescending: boolean;
};

const SORTS = {
  added: {
    label: "Date added",
    compare: (a, b) => a.addedAt.localeCompare(b.addedAt),
    missing: () => false,
    ascending: "Oldest first",
    descending: "Newest first",
    startsDescending: true,
  },
  title: {
    label: "Title",
    compare: () => 0,
    missing: () => false,
    ascending: "A to Z",
    descending: "Z to A",
    startsDescending: false,
  },
  hours: {
    label: "Hours to finish",
    compare: (a, b) => (a.game.timeToBeatHours ?? 0) - (b.game.timeToBeatHours ?? 0),
    missing: (entry) => entry.game.timeToBeatHours === null,
    ascending: "Shortest first",
    descending: "Longest first",
    startsDescending: false,
  },
  year: {
    label: "Release year",
    compare: (a, b) => (a.game.releaseDate ?? "").localeCompare(b.game.releaseDate ?? ""),
    missing: (entry) => entry.game.releaseDate === null,
    ascending: "Oldest first",
    descending: "Newest first",
    startsDescending: true,
  },
} satisfies Record<string, Sort>;

type SortKey = keyof typeof SORTS;

function sortEntries(entries: LibraryEntry[], key: SortKey, descending: boolean): LibraryEntry[] {
  const sort: Sort = SORTS[key];
  const direction = descending ? -1 : 1;

  return [...entries].sort(
    (a, b) =>
      Number(sort.missing(a)) - Number(sort.missing(b)) ||
      direction * sort.compare(a, b) ||
      // Ties, and the title sort itself, fall back to the title.
      (key === "title" ? direction : 1) * a.game.title.localeCompare(b.game.title),
  );
}

// Under a cover, the value the library is sorted by replaces the genre, so the order makes sense.
function sortNote(entry: LibraryEntry, key: SortKey): string | null {
  if (key === "hours") {
    const hours = entry.game.timeToBeatHours;
    return hours === null ? "Length unknown" : `About ${hours} ${hours === 1 ? "hr" : "hrs"}`;
  }
  if (key === "year") return entry.game.releaseDate?.slice(0, 4) ?? "Year unknown";

  return null;
}

export function LibraryView() {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [genre, setGenre] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("added");
  const [descending, setDescending] = useState(true);
  const orderLabel = descending ? SORTS[sort].descending : SORTS[sort].ascending;

  function chooseSort(key: SortKey) {
    setSort(key);
    setDescending(SORTS[key].startsDescending);
  }
  // The server render cannot read storage, so it always starts on the grid.
  const layout = useSyncExternalStore(subscribeToLayout, readLayout, () => "grid" as Layout);

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

  const term = query.trim().toLowerCase();
  const visible = entries.filter(
    (entry) =>
      (!genre || entry.game.genres.some((name) => shortGenre(name) === genre)) &&
      (!term || entry.game.title.toLowerCase().includes(term)),
  );
  const sorted = sortEntries(visible, sort, descending);
  const count = entries.length;
  const filtered = genre !== null || term !== "";

  // The tile belongs to the full, large-cover grid. Search results and filters hide it.
  const showAddTile = !filtered && layout === "grid";

  function clearFilters() {
    setGenre(null);
    setQuery("");
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-pixel text-6xl leading-[0.9] text-forest">Your library</h1>
          {count > 0 && (
            <p className="mt-2 text-lg text-muted">
              {filtered ? `${visible.length} of ${count}` : count} {count === 1 ? "game" : "games"}
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

      {count > 1 && (
        <div className="mt-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-1">
          <div role="search" className="flex min-w-0 flex-1 basis-64 items-center gap-3">
            <label htmlFor="library-search" className="pixel-label shrink-0 text-muted">
              Search
            </label>
            <input
              id="library-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Game title"
              autoComplete="off"
              maxLength={100}
              className="min-h-11 w-full max-w-sm min-w-0 bg-surface px-3 text-forest pixel-frame placeholder:text-muted/70"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-3">
              <span className="pixel-label text-muted">Sort by</span>
              <select
                value={sort}
                onChange={(event) => chooseSort(event.target.value as SortKey)}
                className="pixel-select min-h-11 cursor-pointer bg-surface pl-3 font-semibold text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
              >
                {(Object.keys(SORTS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORTS[key].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setDescending((current) => !current)}
              aria-label={`Order: ${orderLabel}. Reverse the order.`}
              title={orderLabel}
              className="inline-flex size-11 cursor-pointer items-center justify-center bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
            >
              <svg
                viewBox="0 0 7 8"
                className={`h-4 w-3.5 fill-current ${descending ? "" : "rotate-180"}`}
                shapeRendering="crispEdges"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M3 0h1v4H3zM0 4h7v1H0zM1 5h5v1H1zM2 6h3v1H2zM3 7h1v1H3z" />
              </svg>
            </button>
          </div>

          <div role="group" aria-label="Library layout" className="flex gap-2">
            {LAYOUTS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={layout === option.key}
                aria-label={option.label}
                title={option.label}
                onClick={() => saveLayout(option.key)}
                className={`inline-flex size-11 cursor-pointer items-center justify-center ${
                  layout === option.key
                    ? "bg-forest text-surface"
                    : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
                }`}
              >
                <PixelIcon name={option.icon} />
              </button>
            ))}
          </div>
        </div>
      )}

      {count > 1 && filters.length > 1 && (
        <div
          role="group"
          aria-label="Filter by genre"
          className="mt-5 flex flex-wrap items-center gap-2.5 border-y-4 border-dotted border-fern py-4"
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
        {state.status === "loading" &&
          (layout === "list" ? (
            <RowListSkeleton label="Loading your library" count={6} />
          ) : (
            <CoverGridSkeleton label="Loading your library" variant={layout} />
          ))}

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

        {count > 0 && visible.length === 0 && (
          <div className="space-y-4">
            <Notice tone="info">
              No games in your library match
              {term && <> &quot;{query.trim()}&quot;</>}
              {term && genre && " in"}
              {genre && ` ${genre}`}.
            </Notice>
            <button type="button" onClick={clearFilters} className="btn btn-secondary mx-1">
              Show all games
            </button>
          </div>
        )}

        {visible.length > 0 && layout === "list" && (
          <ul className="space-y-4 px-1">
            {sorted.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/library/${entry.id}`}
                  className="group flex items-center gap-4 bg-surface p-3 pixel-frame transition duration-200 ease-out [--frame:var(--color-fern)] hover:-translate-y-1 hover:[--frame:var(--color-emerald)] focus-visible:-translate-y-1 focus-visible:[--frame:var(--color-emerald)]"
                >
                  <GameCover
                    title={entry.game.title}
                    coverUrl={entry.game.coverUrl}
                    className="w-12 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-bold leading-snug text-forest">
                      {entry.game.title}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {genreLine(entry.game.genres, 3)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right text-sm text-muted sm:block">
                    {listDetails(entry)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {visible.length > 0 && layout !== "list" && (
          <ul
            className={
              layout === "compact"
                ? "grid grid-cols-3 gap-x-4 gap-y-5 px-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8"
                : "grid grid-cols-2 gap-x-6 gap-y-8 px-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            }
          >
            {/* First in the grid, so it is reachable without scrolling past every game. */}
            {showAddTile && <AddGameTile />}

            {sorted.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/library/${entry.id}`}
                  className={`group flex flex-col outline-offset-8 ${
                    layout === "compact" ? "gap-2" : "gap-3"
                  }`}
                >
                  <span className={`relative block ring-4 ring-forest group-hover:ring-emerald group-focus-visible:ring-emerald ${coverLift}`}>
                    <GameCover title={entry.game.title} coverUrl={entry.game.coverUrl} />
                    {layout === "grid" && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-3 left-3 hidden bg-forest px-2.5 py-1.5 text-sm font-bold text-surface group-hover:block group-focus-visible:block"
                      >
                        View details
                      </span>
                    )}
                  </span>
                  {layout === "compact" ? (
                    <span>
                      <span className="line-clamp-2 text-sm font-bold leading-snug text-forest">
                        {entry.game.title}
                      </span>
                      {sortNote(entry, sort) && (
                        <span className="block text-xs text-muted">{sortNote(entry, sort)}</span>
                      )}
                    </span>
                  ) : (
                    <span>
                      <span className="block text-lg font-bold leading-snug text-forest">
                        {entry.game.title}
                      </span>
                      <span className="block text-sm text-muted">
                        {sortNote(entry, sort) ?? genreLine(entry.game.genres)}
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            ))}

            {/* And again at the end, for anyone who has scrolled through a long library. */}
            {showAddTile && visible.length >= TAIL_TILE_MIN_GAMES && <AddGameTile />}
          </ul>
        )}
      </div>
    </div>
  );
}
