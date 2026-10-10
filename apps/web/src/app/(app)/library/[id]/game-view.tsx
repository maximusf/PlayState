"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ApiError,
  errorMessage,
  useApi,
  type LibraryEntryDetail,
  type SessionLength,
} from "@/lib/api";
import { shortGenre } from "@/lib/genres";
import { EmptyState, GameCover, Notice, PixelLoader } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; entry: LibraryEntryDetail };

const backLink =
  "inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4 hover:no-underline";
const tag = "bg-surface px-3 py-1.5 text-[0.9375rem] font-semibold text-forest ring-2 ring-fern ring-inset";

const SESSION_OPTIONS: { value: SessionLength | null; label: string }[] = [
  { value: "SHORT", label: "Under an hour" },
  { value: "MEDIUM", label: "1 to 2 hours" },
  { value: "LONG", label: "2+ hours" },
  { value: null, label: "Not sure" },
];

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function TagRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;

  return (
    <>
      <dt className="pixel-label self-center text-muted">{label}</dt>
      <dd className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className={tag}>
            {value}
          </span>
        ))}
      </dd>
    </>
  );
}

export function GameView({ id }: { id: string }) {
  const api = useApi();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<LibraryEntryDetail>(`/api/library/${encodeURIComponent(id)}`).then(
      (entry) => {
        if (!cancelled) setState({ status: "ready", entry });
      },
      (error) => {
        if (cancelled) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: "missing" }
            : { status: "error", message: errorMessage(error) },
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api, id, reloadKey]);

  function retry() {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  // Shows the new tag straight away, and puts the old one back if saving fails.
  async function tagSession(value: SessionLength | null) {
    if (state.status !== "ready") return;
    const previous = state.entry.sessionLength;

    setSessionError(null);
    setState({ status: "ready", entry: { ...state.entry, sessionLength: value } });

    try {
      await api(`/api/library/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { sessionLength: value },
      });
    } catch (error) {
      setSessionError(`That was not saved. ${errorMessage(error)}`);
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", entry: { ...current.entry, sessionLength: previous } }
          : current,
      );
    }
  }

  async function remove() {
    setRemoving(true);
    setRemoveError(null);

    try {
      await api(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
      router.push("/library");
    } catch (error) {
      setRemoveError(`This game was not removed. ${errorMessage(error)}`);
      setRemoving(false);
    }
  }

  return (
    <div>
      <Link href="/library" className={backLink}>
        Back to your library
      </Link>

      <div className="mt-5">
        {state.status === "loading" && <PixelLoader label="Loading game" />}

        {state.status === "error" && (
          <div className="space-y-4">
            <Notice tone="error">{state.message}</Notice>
            <button type="button" onClick={retry} className="btn btn-secondary mx-1">
              Try again
            </button>
          </div>
        )}

        {state.status === "missing" && (
          <div className="px-1">
            <EmptyState
              title="That game is not in your library."
              action={
                <Link href="/library" className="btn btn-primary mb-2">
                  Open your library
                </Link>
              }
            >
              It may have been removed. Your other games are still there.
            </EmptyState>
          </div>
        )}

        {state.status === "ready" && (
          <article className="flex flex-col gap-10 md:flex-row md:items-start md:gap-12">
            <div className="mx-auto w-56 shrink-0 px-1 pb-3 sm:w-64 md:mx-0 md:w-80">
              <GameCover
                title={state.entry.game.title}
                coverUrl={state.entry.game.coverUrl}
                className="pixel-raised"
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="pixel-label text-pine">
                In your library since {dateFormat.format(new Date(state.entry.addedAt))}
              </p>
              <h1 className="mt-3 font-pixel text-7xl leading-[0.88] text-forest lg:text-[5.25rem]">
                {state.entry.game.title}
              </h1>
              {state.entry.game.releaseDate && (
                <p className="mt-2 text-lg text-muted">
                  Released {state.entry.game.releaseDate.slice(0, 4)}
                </p>
              )}
              {state.entry.game.timeToBeatHours !== null && (
                <p className="text-lg text-muted">
                  About {state.entry.game.timeToBeatHours}{" "}
                  {state.entry.game.timeToBeatHours === 1 ? "hour" : "hours"} to finish, according
                  to IGDB
                </p>
              )}

              {state.entry.summary && (
                <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate">
                  {state.entry.summary}
                </p>
              )}

              <dl className="mt-7 grid grid-cols-1 gap-x-5 gap-y-3 border-y-4 border-dotted border-fern py-6 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-y-4">
                <TagRow label="Genres" values={state.entry.game.genres.map(shortGenre)} />
                <TagRow label="Themes" values={state.entry.game.themes} />
                <TagRow label="Play" values={state.entry.game.gameModes} />
              </dl>

              <section className="mt-7">
                <h2 className="font-pixel text-3xl leading-none text-forest">
                  How long do you usually play this?
                </h2>
                <p className="mt-2 text-slate">
                  The picker uses your answer instead of guessing from the genre.
                  {state.entry.pickedFor.length > 0 &&
                    ` You have chosen this game ${state.entry.pickedFor.length} ${
                      state.entry.pickedFor.length === 1 ? "time" : "times"
                    } from the picker.`}
                </p>
                <div role="group" aria-label="Usual session length" className="mt-4 flex flex-wrap gap-2.5">
                  {SESSION_OPTIONS.map((option) => {
                    const selected = state.entry.sessionLength === option.value;

                    return (
                      <button
                        key={option.label}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => tagSession(option.value)}
                        className={`inline-flex min-h-11 cursor-pointer items-center px-4 text-[0.9375rem] font-semibold ${
                          selected
                            ? "bg-forest text-surface"
                            : "bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {sessionError && (
                  <div className="mt-4">
                    <Notice tone="error">{sessionError}</Notice>
                  </div>
                )}
              </section>

              {state.entry.pickerChoices.length > 0 && (
                <section className="mt-7 bg-surface p-5 ring-2 ring-fern ring-inset">
                  <h2 className="font-pixel text-3xl leading-none text-forest">
                    When PlayState suggests this
                  </h2>
                  <p className="mt-2 text-slate">
                    It can come up when you choose any of these in the picker:
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {state.entry.pickerChoices.map((choice) => (
                      <li
                        key={choice}
                        className="bg-forest px-3 py-1.5 text-[0.9375rem] font-semibold text-surface"
                      >
                        {choice}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {removeError && (
                <div className="mt-6">
                  <Notice tone="error">{removeError}</Notice>
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-5 px-1 pb-3">
                <Link href="/pick" className="btn btn-primary">
                  Pick a game
                </Link>
                <button
                  type="button"
                  onClick={remove}
                  disabled={removing}
                  className="min-h-11 cursor-pointer px-2 font-semibold text-danger underline underline-offset-4 hover:no-underline disabled:opacity-60"
                >
                  {removing ? "Removing" : "Remove from library"}
                </button>
              </div>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
