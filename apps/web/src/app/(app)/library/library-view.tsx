"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { errorMessage, useApi, type LibraryEntry } from "@/lib/api";
import { genreLine, shortGenre } from "@/lib/genres";
import { Dialog } from "@/components/dialog";
import { PixelIcon, type PixelIconName } from "@/components/pixel-icons";
import { RandomDiceLink } from "@/components/random-dice-link";
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

// A small badge for a game added as shared through Steam Family.
function FamilyBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block bg-mint px-1.5 pt-0.5 font-pixel text-sm leading-none tracking-wider text-forest uppercase ring-2 ring-forest ${className}`}
    >
      Family
      <span className="sr-only"> (shared through Steam Family)</span>
    </span>
  );
}

// The box in a tile's corner while picking games. It mirrors the real checkbox beside it.
function SelectMark({ selected, className = "" }: { selected: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-7 shrink-0 items-center justify-center ring-4 ring-forest ${
        selected ? "bg-emerald text-forest" : "bg-surface text-transparent"
      } ${className}`}
    >
      <PixelIcon name="check" className="size-5" />
    </span>
  );
}

// How long a finger must rest on a game to open its menu, as a right-click would.
const LONG_PRESS_MS = 500;

// The menu is a fixed size, so it can be kept on screen without measuring it.
const MENU_WIDTH = 224;
const MENU_HEIGHT = 232;

const menuItem =
  "flex min-h-11 w-full cursor-pointer items-center px-4 text-left font-semibold text-forest hover:bg-mint focus-visible:bg-mint";

type MenuState = { entry: LibraryEntry; x: number; y: number };

// What a right-click, the menu key or a long press on a game opens.
function GameMenu({
  menu,
  selected,
  onClose,
  onToggleSelect,
  onShare,
  onDelete,
}: {
  menu: MenuState;
  selected: boolean;
  // `restoreFocus` is false when the player clicked elsewhere, so focus is not pulled back.
  onClose: (restoreFocus: boolean) => void;
  onToggleSelect: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();

    function away(event: Event) {
      if (!ref.current?.contains(event.target as Node)) onClose(false);
    }
    function dismiss() {
      onClose(false);
    }

    document.addEventListener("pointerdown", away);
    // The menu would drift away from its game if the page moved under it.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);

    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [onClose]);

  function onKeyDown(event: React.KeyboardEvent) {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };

    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose(true);
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${menu.entry.game.title}`}
      onKeyDown={onKeyDown}
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 bg-surface py-1 pixel-frame"
    >
      <Link
        role="menuitem"
        href={`/library/${menu.entry.id}`}
        className={menuItem}
        onClick={() => onClose(false)}
      >
        Open game page
      </Link>
      <button type="button" role="menuitem" onClick={onToggleSelect} className={menuItem}>
        {selected ? "Remove from selection" : "Add to selection"}
      </button>
      <button type="button" role="menuitem" onClick={onShare} className={menuItem}>
        Share
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className={`${menuItem} border-t-2 border-dotted border-fern text-danger`}
      >
        Delete
      </button>
    </div>
  );
}

// The frame around one game. It is the link to the game, or while picking games, a checkbox.
function TileFrame({
  entry,
  selecting,
  selected,
  onToggle,
  className,
  children,
}: {
  entry: LibraryEntry;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  className: string;
  children: React.ReactNode;
}) {
  if (selecting) {
    return (
      <label
        className={`${className} cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-8 has-[:focus-visible]:outline-forest`}
      >
        <input
          id={`tile-${entry.id}`}
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="sr-only"
        />
        <span className="sr-only">Select {entry.game.title}</span>
        {children}
      </label>
    );
  }

  return (
    <Link id={`tile-${entry.id}`} href={`/library/${entry.id}`} className={className}>
      {children}
    </Link>
  );
}

// Puts focus back on a game's tile, once the page has settled after a menu or dialog closes.
function focusTile(id: string) {
  requestAnimationFrame(() => document.getElementById(`tile-${id}`)?.focus());
}

type Confirm = { ids: string[]; titles: string[]; anchorId: string | null };

// Library deletes go out in batches the API accepts.
const DELETE_BATCH = 200;

export function LibraryView() {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [genre, setGenre] = useState<string | null>(null);
  const [familyOnly, setFamilyOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("added");
  const [descending, setDescending] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPress = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Set when a long press opened the menu, so the tap that ends it does not also open the game.
  const swallowClick = useRef(false);
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

  const familyCount = entries.filter((entry) => entry.familyShared).length;
  const term = query.trim().toLowerCase();
  const visible = entries.filter(
    (entry) =>
      (!genre || entry.game.genres.some((name) => shortGenre(name) === genre)) &&
      (!familyOnly || entry.familyShared) &&
      (!term || entry.game.title.toLowerCase().includes(term)),
  );
  const sorted = sortEntries(visible, sort, descending);
  const count = entries.length;
  const filtered = genre !== null || familyOnly || term !== "";
  // What the Filters button counts. The title search sits in the page, so it is not included.
  const activeFilters = Number(genre !== null) + Number(familyOnly);
  const canFilter = filters.length > 1 || familyCount > 0;

  // Games gone from the library drop out of the selection without any bookkeeping.
  const picked = entries.filter((entry) => selected.has(entry.id));
  const allVisiblePicked = visible.length > 0 && visible.every((entry) => selected.has(entry.id));

  // The tile belongs to the full, large-cover grid. Search results and filters hide it.
  const showAddTile = !filtered && layout === "grid" && !selecting;

  function clearFilters() {
    setGenre(null);
    setFamilyOnly(false);
    setQuery("");
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function endSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const entry of visible) {
        if (allVisiblePicked) next.delete(entry.id);
        else next.add(entry.id);
      }
      return next;
    });
  }

  function say(message: string) {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu((current) => {
      if (current && restoreFocus) focusTile(current.entry.id);
      return null;
    });
  }, []);

  function openMenu(entry: LibraryEntry, x: number, y: number) {
    setMenu({ entry, x, y });
  }

  // The menu key and Shift+F10 open it at the game, for anyone not using a mouse.
  function onTileKeyDown(event: React.KeyboardEvent, entry: LibraryEntry) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;

    event.preventDefault();
    const box = (event.target as HTMLElement).closest("li")?.getBoundingClientRect();
    openMenu(entry, (box?.left ?? 0) + 24, (box?.top ?? 0) + 24);
  }

  function startLongPress(event: React.PointerEvent, entry: LibraryEntry) {
    if (event.pointerType !== "touch") return;

    const { clientX, clientY } = event;
    clearTimeout(longPress.current);
    longPress.current = setTimeout(() => {
      swallowClick.current = true;
      openMenu(entry, clientX, clientY);
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    clearTimeout(longPress.current);
  }

  function tileProps(entry: LibraryEntry) {
    return {
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        openMenu(entry, event.clientX, event.clientY);
      },
      onKeyDown: (event: React.KeyboardEvent) => onTileKeyDown(event, entry),
      onPointerDown: (event: React.PointerEvent) => startLongPress(event, entry),
      onPointerUp: cancelLongPress,
      onPointerCancel: cancelLongPress,
      onPointerMove: cancelLongPress,
      onClickCapture: (event: React.MouseEvent) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }

  async function share(entry: LibraryEntry) {
    const title = entry.game.title;
    // The game page is private to its owner, so the link opens a search for the game instead.
    const url = `${window.location.origin}/library/add?q=${encodeURIComponent(title)}`;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `Have a look at ${title} on PlayState.`, url });
        return;
      } catch (error) {
        // Closing the share sheet is a choice, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      say(`Copied a link to ${title}.`);
    } catch {
      say("The link could not be copied.");
    }
  }

  function askToDelete(entries: LibraryEntry[], anchorId: string | null) {
    setDeleteError(null);
    setConfirm({
      ids: entries.map((entry) => entry.id),
      titles: entries.map((entry) => entry.game.title),
      anchorId,
    });
  }

  async function deleteConfirmed() {
    if (!confirm) return;

    setDeleting(true);
    setDeleteError(null);
    const gone = new Set<string>();

    try {
      if (confirm.ids.length === 1) {
        await api(`/api/library/${encodeURIComponent(confirm.ids[0])}`, { method: "DELETE" });
        gone.add(confirm.ids[0]);
      } else {
        for (let start = 0; start < confirm.ids.length; start += DELETE_BATCH) {
          const ids = confirm.ids.slice(start, start + DELETE_BATCH);
          await api("/api/library/delete", { method: "POST", body: { ids } });
          for (const id of ids) gone.add(id);
        }
      }

      setConfirm(null);
      say(gone.size === 1 ? "Game deleted." : `${gone.size} games deleted.`);
      if (selecting && gone.size > 1) endSelecting();
    } catch (error) {
      setDeleteError(
        `${gone.size > 0 ? "Some games were not deleted. " : "Nothing was deleted. "}${errorMessage(error)}`,
      );
    } finally {
      setDeleting(false);
      // Whatever did go stays gone on screen, even when a later batch failed.
      if (gone.size > 0) {
        setState((current) =>
          current.status === "ready"
            ? { ...current, entries: current.entries.filter((entry) => !gone.has(entry.id)) }
            : current,
        );
      }
    }
  }

  // Everything one game needs, shared by the three layouts.
  function tileState(entry: LibraryEntry) {
    return {
      entry,
      selecting,
      selected: selected.has(entry.id),
      onToggle: () => toggleSelected(entry.id),
    };
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
            <RandomDiceLink count={count} />
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

          <div className="flex flex-wrap items-center gap-2">
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

            {canFilter && (
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={
                  activeFilters > 0 ? `Filters, ${activeFilters} active` : "Filters"
                }
                title="Filters"
                onClick={() => setFiltersOpen(true)}
                className={`relative inline-flex size-11 cursor-pointer items-center justify-center ${
                  activeFilters > 0
                    ? "bg-mint text-forest ring-2 ring-forest ring-inset"
                    : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
                }`}
              >
                <PixelIcon name="filter" />
                {activeFilters > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-2 -right-2 flex min-w-5 items-center justify-center bg-forest px-1 pt-0.5 font-pixel text-sm leading-5 text-surface"
                  >
                    {activeFilters}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              aria-pressed={selecting}
              onClick={() => (selecting ? endSelecting() : setSelecting(true))}
              className={`inline-flex min-h-11 cursor-pointer items-center px-4 font-semibold ${
                selecting
                  ? "bg-forest text-surface"
                  : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
              }`}
            >
              Select
            </button>
          </div>
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
              {term && (genre || familyOnly) && " in"}
              {genre && ` ${genre}`}
              {familyOnly && " shared through Steam Family"}.
            </Notice>
            <button type="button" onClick={clearFilters} className="btn btn-secondary mx-1">
              Show all games
            </button>
          </div>
        )}

        {visible.length > 0 && layout === "list" && (
          <ul className="space-y-4 px-1">
            {sorted.map((entry) => (
              <li key={entry.id} className="[-webkit-touch-callout:none]" {...tileProps(entry)}>
                <TileFrame
                  {...tileState(entry)}
                  className="group flex items-center gap-4 bg-surface p-3 pixel-frame transition duration-200 ease-out [--frame:var(--color-fern)] hover:-translate-y-1 hover:[--frame:var(--color-emerald)] focus-visible:-translate-y-1 focus-visible:[--frame:var(--color-emerald)]"
                >
                  {selecting && <SelectMark selected={selected.has(entry.id)} />}
                  <GameCover
                    title={entry.game.title}
                    coverUrl={entry.game.coverUrl}
                    className="w-12 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-lg font-bold leading-snug text-forest">
                        {entry.game.title}
                      </span>
                      {entry.familyShared && <FamilyBadge className="shrink-0" />}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {genreLine(entry.game.genres, 3)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right text-sm text-muted sm:block">
                    {listDetails(entry)}
                  </span>
                </TileFrame>
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
              <li key={entry.id} className="[-webkit-touch-callout:none]" {...tileProps(entry)}>
                <TileFrame
                  {...tileState(entry)}
                  className={`group flex flex-col outline-offset-8 ${
                    layout === "compact" ? "gap-2" : "gap-3"
                  }`}
                >
                  <span
                    className={`relative block ring-4 ${
                      selected.has(entry.id)
                        ? "ring-emerald"
                        : "ring-forest group-hover:ring-emerald group-focus-visible:ring-emerald"
                    } ${coverLift}`}
                  >
                    <GameCover title={entry.game.title} coverUrl={entry.game.coverUrl} />
                    {selecting && (
                      <SelectMark selected={selected.has(entry.id)} className="absolute top-2 left-2" />
                    )}
                    {entry.familyShared && (
                      <FamilyBadge className="absolute top-2 right-2" />
                    )}
                    {layout === "grid" && !selecting && (
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
                </TileFrame>
              </li>
            ))}

            {/* And again at the end, for anyone who has scrolled through a long library. */}
            {showAddTile && visible.length >= TAIL_TILE_MIN_GAMES && <AddGameTile />}
          </ul>
        )}

        {selecting && (
          <div
            role="region"
            aria-label="Selected games"
            className="sticky bottom-4 z-20 mx-1 mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 bg-surface p-3 pixel-frame"
          >
            <p role="status" className="mr-auto font-semibold text-forest">
              {picked.length} selected
            </p>
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={visible.length === 0}
              className="btn btn-secondary"
            >
              {allVisiblePicked ? "Deselect all" : `Select all (${visible.length})`}
            </button>
            <button
              type="button"
              onClick={() => askToDelete(picked, null)}
              disabled={picked.length === 0}
              className="btn btn-secondary text-danger"
            >
              Delete
            </button>
            <button type="button" onClick={endSelecting} className="btn btn-primary">
              Done
            </button>
          </div>
        )}
      </div>

      {menu && (
        <GameMenu
          menu={menu}
          selected={selected.has(menu.entry.id)}
          onClose={closeMenu}
          onToggleSelect={() => {
            const id = menu.entry.id;
            setSelecting(true);
            toggleSelected(id);
            closeMenu(true);
          }}
          onShare={() => {
            const entry = menu.entry;
            closeMenu(true);
            share(entry);
          }}
          onDelete={() => {
            const entry = menu.entry;
            closeMenu(false);
            askToDelete([entry], entry.id);
          }}
        />
      )}

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="space-y-6">
          {filters.length > 1 && (
            <div role="group" aria-label="Filter by genre">
              <p className="pixel-label text-muted">Genre</p>
              <div className="mt-3 flex flex-wrap gap-2.5">
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
            </div>
          )}

          {familyCount > 0 && (
            <div role="group" aria-label="Filter by source">
              <p className="pixel-label text-muted">Source</p>
              <div className="mt-3">
                <button
                  type="button"
                  aria-pressed={familyOnly}
                  onClick={() => setFamilyOnly((current) => !current)}
                  className={`${filterChip} ${
                    familyOnly
                      ? "bg-forest text-surface"
                      : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
                  }`}
                >
                  Steam Family {familyCount}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t-4 border-dotted border-fern pt-5">
          <button
            type="button"
            onClick={() => {
              setGenre(null);
              setFamilyOnly(false);
            }}
            disabled={activeFilters === 0}
            className="btn btn-secondary"
          >
            Clear filters
          </button>
          <button type="button" onClick={() => setFiltersOpen(false)} className="btn btn-primary">
            Show {visible.length} {visible.length === 1 ? "game" : "games"}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={confirm !== null}
        onClose={() => !deleting && setConfirm(null)}
        title={confirm?.ids.length === 1 ? "Delete this game?" : `Delete ${confirm?.ids.length} games?`}
        restoreFocus={confirm?.anchorId ? () => focusTile(confirm.anchorId!) : undefined}
      >
        <p className="text-slate">
          {confirm?.ids.length === 1
            ? `${confirm.titles[0]} will be removed from your library.`
            : "These games will be removed from your library, including any the current filters hide."}{" "}
          This cannot be undone.
        </p>
        {deleteError && (
          <div className="mt-4">
            <Notice tone="error">{deleteError}</Notice>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-4">
          <button
            type="button"
            data-autofocus
            onClick={() => setConfirm(null)}
            disabled={deleting}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={deleteConfirmed}
            disabled={deleting}
            className="btn btn-secondary text-danger"
          >
            {deleting ? "Deleting" : "Delete"}
          </button>
        </div>
      </Dialog>

      {/* Quiet confirmations such as "Copied". Always present so screen readers announce changes. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
        {notice && (
          <p className="bg-forest px-4 py-2 font-semibold text-surface pixel-frame">{notice}</p>
        )}
      </div>
    </div>
  );
}
