"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, useApi, type Recommendation } from "@/lib/api";
import { EmptyState, GameCover, Notice, PixelLoader } from "@/components/ui";

const TIMES = [
  { value: "UNDER_30", label: "Under 30 min" },
  { value: "THIRTY_TO_SIXTY", label: "30 to 60 min" },
  { value: "ONE_TO_TWO_HOURS", label: "1 to 2 hours" },
  { value: "TWO_PLUS_HOURS", label: "2+ hours" },
  { value: "ANY", label: "Any" },
] as const;

const TYPES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Shooter",
  "Puzzle",
  "Platformer",
  "Racing",
  "Sports",
  "Sandbox",
] as const;

const MODES = [
  { value: "SINGLE_PLAYER", label: "Single-player" },
  { value: "MULTIPLAYER", label: "Multiplayer" },
  { value: "EITHER", label: "Either" },
] as const;

type Result =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty-library" }
  | { status: "ready"; games: Recommendation[] };

// A native radio or checkbox, presented as a select-screen tile.
function OptionTile({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="group flex min-h-11 cursor-pointer items-center gap-2 bg-surface px-3 py-2 text-forest pixel-frame [--frame:var(--color-sage)] hover:[--frame:var(--color-emerald)] has-checked:bg-mint has-checked:font-semibold has-checked:[--frame:var(--color-forest)] has-focus-visible:outline-3 has-focus-visible:outline-offset-[7px] has-focus-visible:outline-forest">
      <input {...input} className="sr-only" />
      <span aria-hidden="true" className="hidden text-emerald group-has-checked:inline">
        &#9654;
      </span>
      {label}
    </label>
  );
}

const fieldset = "min-w-0";
const legend = "font-pixel text-xl text-forest";
const tiles = "mt-4 grid grid-cols-2 gap-x-5 gap-y-4 px-1 sm:grid-cols-3 md:grid-cols-4";

export function PickerView() {
  const api = useApi();
  const [time, setTime] = useState<string>("ANY");
  const [types, setTypes] = useState<string[]>([]);
  const [mode, setMode] = useState<string>("EITHER");
  const [result, setResult] = useState<Result>({ status: "idle" });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the results so keyboard and screen reader users land on them.
  useEffect(() => {
    if (result.status !== "ready") return;
    resultsRef.current?.focus({ preventScroll: true });
    resultsRef.current?.scrollIntoView({ block: "start" });
  }, [result]);

  function toggleType(type: string) {
    setTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function findGames() {
    setResult({ status: "loading" });
    setChosenId(null);

    try {
      const data = await api<{ recommendations: Recommendation[] }>("/api/recommendations", {
        method: "POST",
        body: { availableTime: time, genres: types, gameMode: mode },
      });
      setResult({ status: "ready", games: data.recommendations });
    } catch (error) {
      setResult(
        error instanceof ApiError && error.code === "EMPTY_LIBRARY"
          ? { status: "empty-library" }
          : { status: "error", message: errorMessage(error) },
      );
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-pixel text-3xl text-forest">Pick a game</h1>
      <p className="mt-2 text-muted">Three quick answers. PlayState suggests up to 3 games.</p>

      <form
        className="mt-8 space-y-9"
        onSubmit={(event) => {
          event.preventDefault();
          findGames();
        }}
      >
        <fieldset className={fieldset}>
          <legend className={legend}>How much time do you have?</legend>
          <div className={tiles}>
            {TIMES.map((option) => (
              <OptionTile
                key={option.value}
                type="radio"
                name="time"
                label={option.label}
                value={option.value}
                checked={time === option.value}
                onChange={() => setTime(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>What sounds good?</legend>
          <p className="mt-1 text-sm text-muted">
            Choose any that fit, or leave them all off for anything.
          </p>
          <div className={tiles}>
            {TYPES.map((type) => (
              <OptionTile
                key={type}
                type="checkbox"
                name="types"
                label={type}
                value={type}
                checked={types.includes(type)}
                onChange={() => toggleType(type)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>How do you want to play?</legend>
          <div className={tiles}>
            {MODES.map((option) => (
              <OptionTile
                key={option.value}
                type="radio"
                name="mode"
                label={option.label}
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <div className="px-1 pb-2">
          <button
            type="submit"
            disabled={result.status === "loading"}
            className="btn btn-primary w-full sm:w-auto"
          >
            {result.status === "ready" ? "Pick again" : "Find games"}
          </button>
        </div>
      </form>

      <section className="mt-10" aria-live="polite">
        {result.status === "loading" && <PixelLoader label="Finding games" />}

        {result.status === "error" && <Notice tone="error">{result.message}</Notice>}

        {result.status === "empty-library" && (
          <div className="px-1">
            <EmptyState
              title="Your library is empty."
              action={
                <Link href="/library/add" className="btn btn-primary mb-2">
                  Add a game
                </Link>
              }
            >
              PlayState only suggests games you own. Add a few, then come back.
            </EmptyState>
          </div>
        )}

        {result.status === "ready" && result.games.length === 0 && (
          <Notice tone="info">
            Nothing in your library fits that. Try fewer game types, or set how you want to play to
            Either.
          </Notice>
        )}

        {result.status === "ready" && result.games.length > 0 && (
          <>
            <h2 ref={resultsRef} tabIndex={-1} className="scroll-mt-6 font-pixel text-2xl text-forest">
              {result.games.length === 1 ? "Your pick" : "Your picks"}
            </h2>
            <ol className="mt-5 space-y-6 px-1">
              {result.games.map((game, index) => {
                const chosen = chosenId === game.id;

                return (
                  <li
                    key={game.id}
                    className={`flex gap-4 p-4 pixel-frame ${chosen ? "bg-mint" : "bg-surface"}`}
                  >
                    <GameCover
                      title={game.title}
                      coverUrl={game.coverUrl}
                      className="w-24 shrink-0 self-start sm:w-28"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="pixel-label text-muted">Pick {index + 1}</p>
                      <h3 className="mt-1 text-xl font-semibold leading-snug text-forest">
                        {game.title}
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        {[game.genres.slice(0, 3).join(", "), game.gameModes.slice(0, 2).join(", ")]
                          .filter(Boolean)
                          .join(" | ")}
                      </p>

                      <p className="pixel-label mt-4 text-forest">Why this fits</p>
                      <ul className="mt-1 space-y-0.5 text-slate">
                        {game.reasons.map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <span aria-hidden="true" className="font-pixel text-emerald">
                              +
                            </span>
                            {reason}
                          </li>
                        ))}
                      </ul>

                      <div className="mt-4">
                        {chosen ? (
                          <p role="status" className="font-semibold text-forest">
                            Locked in. Have fun.
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setChosenId(game.id)}
                            aria-label={`Choose ${game.title}`}
                            className="btn btn-secondary"
                          >
                            Choose this
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
