"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  errorMessage,
  useApi,
  type ImportResult,
  type SteamImportGame,
  type SteamImportPreview,
} from "@/lib/api";
import { genreLine } from "@/lib/genres";
import { GameCover, Notice, PixelLoader } from "@/components/ui";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "preview"; preview: SteamImportPreview; importError: string | null }
  | { status: "importing"; preview: SteamImportPreview }
  | { status: "done"; result: ImportResult };

type Sort = {
  label: string;
  // Sorts low to high. The direction button reverses it.
  compare: (a: SteamImportGame, b: SteamImportGame) => number;
  // Games without the sorted value go last in both directions.
  missing: (game: SteamImportGame) => boolean;
  // Button text for each direction, and the direction a sort starts in.
  ascending: string;
  descending: string;
  startsDescending: boolean;
};

const SORTS = {
  played: {
    label: "Playtime",
    compare: (a, b) => a.playtimeMinutes - b.playtimeMinutes,
    missing: () => false,
    ascending: "Least first",
    descending: "Most first",
    startsDescending: true,
  },
  recent: {
    label: "Last played",
    compare: (a, b) => (a.lastPlayedAt ?? "").localeCompare(b.lastPlayedAt ?? ""),
    missing: (game) => game.lastPlayedAt === null,
    ascending: "Longest ago first",
    descending: "Most recent first",
    startsDescending: true,
  },
  year: {
    label: "Release year",
    compare: (a, b) => (a.releaseYear ?? 0) - (b.releaseYear ?? 0),
    missing: (game) => game.releaseYear === null,
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
} satisfies Record<string, Sort>;

type SortKey = keyof typeof SORTS;

function sortGames(games: SteamImportGame[], key: SortKey, descending: boolean) {
  const sort: Sort = SORTS[key];
  const direction = descending ? -1 : 1;

  return [...games].sort(
    (a, b) =>
      Number(sort.missing(a)) - Number(sort.missing(b)) ||
      direction * sort.compare(a, b) ||
      // Ties, and the title sort itself, fall back to the title.
      (key === "title" ? direction : 1) * a.title.localeCompare(b.title),
  );
}

const lastPlayedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const textLink =
  "inline-flex min-h-11 cursor-pointer items-center font-semibold text-forest underline underline-offset-4 hover:no-underline";

function playtime(minutes: number): string {
  if (minutes === 0) return "Never played";
  if (minutes < 60) return `${minutes} min played`;

  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? "hr" : "hrs"} played`;
}

function plural(count: number): string {
  return `${count} ${count === 1 ? "game" : "games"}`;
}

// Games the player has played start ticked. Steam hides playtime on some profiles,
// and then every game reads as never played, so everything starts ticked instead.
function initialSelection(games: SteamImportGame[]): Set<number> {
  const available = games.filter((game) => !game.inLibrary);
  const played = available.filter((game) => game.playtimeMinutes > 0);

  return new Set((played.length > 0 ? played : available).map((game) => game.igdbId));
}

export function ImportSteamView() {
  const api = useApi();
  const [profile, setProfile] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<SortKey>("played");
  const [descending, setDescending] = useState(true);
  const [hideOwned, setHideOwned] = useState(false);

  const orderLabel = descending ? SORTS[sort].descending : SORTS[sort].ascending;

  function chooseSort(key: SortKey) {
    setSort(key);
    setDescending(SORTS[key].startsDescending);
  }

  const preview =
    state.status === "preview" || state.status === "importing" ? state.preview : null;
  const importing = state.status === "importing";

  const games = useMemo(() => {
    if (!preview) return [];
    const shown = hideOwned ? preview.games.filter((game) => !game.inLibrary) : preview.games;
    return sortGames(shown, sort, descending);
  }, [preview, sort, descending, hideOwned]);

  // Steam leaves out last played dates for some profiles. Without them the sort does nothing.
  const sortKeys = useMemo(() => {
    const hasDates = preview?.games.some((game) => game.lastPlayedAt !== null) ?? false;
    return (Object.keys(SORTS) as SortKey[]).filter((key) => key !== "recent" || hasDates);
  }, [preview]);

  const available = useMemo(
    () => (preview ? preview.games.filter((game) => !game.inLibrary) : []),
    [preview],
  );
  const ownedCount = preview ? preview.games.length - available.length : 0;
  const freeIds = useMemo(
    () => available.filter((game) => game.free).map((game) => game.igdbId),
    [available],
  );
  const freeSelected = freeIds.some((igdbId) => selected.has(igdbId));

  // One button that unticks the free games, or ticks them again once none are ticked.
  function toggleFree() {
    setSelected((current) => {
      const next = new Set(current);
      for (const igdbId of freeIds) {
        if (freeSelected) next.delete(igdbId);
        else next.add(igdbId);
      }
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = profile.trim();

    if (value.length < 2) {
      setState({ status: "error", message: "Paste the link to your Steam profile first." });
      return;
    }

    setState({ status: "loading" });

    try {
      const found = await api<SteamImportPreview>("/api/library/import/steam", {
        method: "POST",
        body: { profile: value },
      });
      setSelected(initialSelection(found.games));
      chooseSort("played");
      setState({ status: "preview", preview: found, importError: null });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }

  function toggle(igdbId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(igdbId)) next.add(igdbId);
      return next;
    });
  }

  async function importSelected() {
    if (state.status !== "preview" || selected.size === 0) return;
    const current = state.preview;

    setState({ status: "importing", preview: current });

    try {
      const result = await api<ImportResult>("/api/library/import", {
        method: "POST",
        body: { igdbIds: [...selected] },
      });
      setState({ status: "done", result });
    } catch (error) {
      setState({
        status: "preview",
        preview: current,
        importError: `Nothing was imported. ${errorMessage(error)}`,
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/library/add" className={`${textLink} text-sm`}>
        Back to add a game
      </Link>
      <h1 className="mt-2 font-pixel text-6xl leading-[0.9] text-forest">Import from Steam</h1>

      {state.status === "done" ? (
        <div className="mt-8 space-y-6">
          <Notice tone="info">
            {state.result.added === 0
              ? "Those games were already in your library."
              : `Added ${plural(state.result.added)} to your library.`}
            {state.result.added > 0 && state.result.skipped > 0 && (
              <> {state.result.skipped} skipped because they were already there.</>
            )}
          </Notice>
          <div className="flex flex-wrap gap-5 px-1 pb-3">
            <Link href="/library" className="btn btn-primary">
              Open your library
            </Link>
            <Link href="/pick" className="btn btn-secondary">
              Pick a game
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-4 text-lg text-slate">
            Paste your Steam profile link. You choose which games to bring in before anything is
            saved.
          </p>

          <form onSubmit={onSubmit} className="mt-6 px-1">
            <label htmlFor="steam-profile" className="pixel-label text-muted">
              Steam profile link
            </label>
            <div className="mt-3 flex gap-5">
              <input
                id="steam-profile"
                type="text"
                inputMode="url"
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
                placeholder="https://steamcommunity.com/id/yourname"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={200}
                aria-describedby="steam-profile-help"
                className="min-h-11 min-w-0 flex-1 bg-surface px-3 text-forest pixel-frame placeholder:text-muted/70"
              />
              <button
                type="submit"
                disabled={state.status === "loading" || importing}
                className="btn btn-primary mb-2"
              >
                Find games
              </button>
            </div>
            <p id="steam-profile-help" className="mt-4 text-sm text-muted">
              Steam only shares your games when Game details is set to Public. In Steam, open your
              profile, then Edit Profile, then Privacy Settings.
            </p>
          </form>

          <div className="mt-8" aria-live="polite">
            {state.status === "loading" && <PixelLoader label="Reading your Steam library" />}

            {state.status === "error" && <Notice tone="error">{state.message}</Notice>}

            {preview && (
              <>
                <p className="text-lg text-forest">
                  Found {plural(preview.games.length)}.
                  {ownedCount > 0 && (
                    <>
                      {" "}
                      {ownedCount} already in your library.{" "}
                      <button
                        type="button"
                        aria-pressed={hideOwned}
                        onClick={() => setHideOwned((current) => !current)}
                        className={textLink}
                      >
                        {hideOwned ? "Show them" : "Hide them"}
                      </button>
                    </>
                  )}
                </p>

                {available.length === 0 && (
                  <div className="mt-4">
                    <Notice tone="info">
                      Every game found on that profile is already in your library.
                    </Notice>
                  </div>
                )}

                {available.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-y-4 border-dotted border-fern py-3">
                    <div className="flex flex-wrap gap-x-5">
                      <button
                        type="button"
                        onClick={() => setSelected(new Set(available.map((game) => game.igdbId)))}
                        className={textLink}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className={textLink}
                      >
                        Select none
                      </button>
                      {freeIds.length > 0 && (
                        <button type="button" onClick={toggleFree} className={textLink}>
                          {freeSelected ? "Unselect" : "Select"} free games ({freeIds.length})
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-3">
                        <span className="pixel-label text-muted">Sort by</span>
                        <select
                          value={sort}
                          onChange={(event) => chooseSort(event.target.value as SortKey)}
                          className="pixel-select min-h-11 cursor-pointer bg-surface pl-3 font-semibold text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
                        >
                          {sortKeys.map((key) => (
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
                  </div>
                )}

                <ul className="mt-6 space-y-5 px-1">
                  {games.map((game) => {
                    const inputId = `import-${game.igdbId}`;

                    return (
                      <li key={game.igdbId}>
                        <label
                          htmlFor={inputId}
                          className={`flex items-center gap-4 bg-surface p-3 pixel-frame ${
                            game.inLibrary ? "opacity-70" : "cursor-pointer"
                          }`}
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={game.inLibrary || selected.has(game.igdbId)}
                            disabled={game.inLibrary || importing}
                            onChange={() => toggle(game.igdbId)}
                            className="size-6 shrink-0 cursor-pointer accent-emerald disabled:cursor-default"
                          />
                          <GameCover
                            title={game.title}
                            coverUrl={game.coverUrl}
                            className="w-14 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold leading-snug text-forest">
                              {game.title}
                              {game.releaseYear && (
                                <span className="font-normal text-muted"> ({game.releaseYear})</span>
                              )}
                            </span>
                            <span className="block truncate text-sm text-muted">
                              {genreLine(game.genres, 3)}
                            </span>
                            <span className="block text-sm font-semibold text-forest">
                              {game.inLibrary
                                ? "Already in your library"
                                : playtime(game.playtimeMinutes)}
                              {game.lastPlayedAt && !game.inLibrary && (
                                <span className="font-normal text-muted">
                                  {" | "}Last played{" "}
                                  {lastPlayedFormat.format(new Date(game.lastPlayedAt))}
                                </span>
                              )}
                              {game.free && !game.inLibrary && (
                                <span className="font-normal text-muted"> | Free to play</span>
                              )}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>

                {preview.unmatched.length > 0 && (
                  <details className="mt-8 bg-surface p-4 ring-2 ring-fern ring-inset">
                    <summary className="min-h-11 cursor-pointer content-center font-semibold text-forest">
                      {preview.unmatched.length} Steam{" "}
                      {preview.unmatched.length === 1 ? "item" : "items"} could not be matched
                    </summary>
                    <p className="mt-2 text-sm text-muted">
                      These are usually DLC, soundtracks, and tools. If one is a game you want, add
                      it by searching for its title.
                    </p>
                    <ul className="mt-3 columns-1 gap-x-6 text-sm text-slate sm:columns-2">
                      {preview.unmatched.map((name, index) => (
                        <li key={`${name}-${index}`} className="break-inside-avoid py-0.5">
                          {name}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {state.status === "preview" && state.importError && (
                  <div className="mt-6">
                    <Notice tone="error">{state.importError}</Notice>
                  </div>
                )}

                {available.length > 0 && (
                  <div className="sticky bottom-0 mt-8 flex flex-wrap items-center justify-between gap-4 bg-paper px-1 pt-4 pb-5">
                    <p className="text-muted">
                      {selected.size} of {available.length} selected
                    </p>
                    <button
                      type="button"
                      onClick={importSelected}
                      disabled={selected.size === 0 || importing}
                      className="btn btn-primary"
                    >
                      {importing ? "Importing" : `Import ${plural(selected.size)}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
