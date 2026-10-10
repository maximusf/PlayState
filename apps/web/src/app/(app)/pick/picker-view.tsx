"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, useApi, type Recommendation } from "@/lib/api";
import { genreLine } from "@/lib/genres";
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

// One question is shown at a time, in this order.
const STEP_COUNT = 3;

type Result =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty-library" }
  | { status: "exhausted" }
  | { status: "ready"; games: Recommendation[] };

// A native radio or checkbox, presented as a select-screen tile.
function OptionTile({
  label,
  detail,
  ...input
}: { label: string; detail?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="group flex min-h-[4.75rem] cursor-pointer items-center justify-between gap-3 bg-surface px-5 py-3 text-lg font-semibold text-forest pixel-frame [--frame:var(--color-fern)] hover:[--frame:var(--color-emerald)] has-checked:bg-mint has-checked:font-bold has-checked:pixel-raised has-focus-visible:outline-3 has-focus-visible:outline-offset-[7px] has-focus-visible:outline-forest">
      <input {...input} className="sr-only" />
      <span className="flex flex-col">
        {label}
        {detail && <span className="text-sm font-normal text-muted">{detail}</span>}
      </span>
      <span aria-hidden="true" className="hidden size-3.5 shrink-0 bg-forest group-has-checked:block" />
    </label>
  );
}

const legend =
  "w-full text-center font-pixel text-6xl leading-[0.9] text-forest outline-none sm:text-7xl";
const helper = "mt-3 text-center text-lg text-muted";
const tiles = "mt-9 grid grid-cols-2 gap-x-5 gap-y-6 px-1 sm:grid-cols-3 lg:grid-cols-4";
const chip = "bg-forest px-3 py-1.5 text-sm font-semibold text-surface";

export function PickerView() {
  const api = useApi();
  const [time, setTime] = useState<string>("ANY");
  const [types, setTypes] = useState<string[]>([]);
  const [mode, setMode] = useState<string>("EITHER");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<Result>({ status: "idle" });
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Library entries already suggested for the current answers.
  const [seen, setSeen] = useState<string[]>([]);
  const questionRef = useRef<HTMLLegendElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // How many library games each type can surface. Null until loaded, or if loading failed.
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<{ genres: { name: string; count: number }[] }>("/api/recommendations/options").then(
      (data) => {
        if (cancelled) return;
        setTypeCounts(Object.fromEntries(data.genres.map((genre) => [genre.name, genre.count])));
      },
      // The picker still works without counts. It just offers every type.
      () => {},
    );

    return () => {
      cancelled = true;
    };
  }, [api]);

  // Offer only the types that match something in the library.
  // With no counts, or an empty library, every type is offered.
  const matchingTypes = typeCounts ? TYPES.filter((type) => (typeCounts[type] ?? 0) > 0) : [];
  const offeredTypes = matchingTypes.length > 0 ? matchingTypes : TYPES;
  const narrowed = offeredTypes.length < TYPES.length;

  const asking = result.status === "idle";
  const lastStep = step === STEP_COUNT - 1;

  // Move focus to the new question so keyboard and screen reader users follow along.
  // Skipped on first load so the page does not steal focus.
  useEffect(() => {
    if (moved.current && asking) questionRef.current?.focus();
  }, [step, asking]);

  // Move focus to the results when they arrive.
  useEffect(() => {
    if (result.status === "ready") resultsRef.current?.focus();
  }, [result]);

  function goTo(next: number) {
    moved.current = true;
    setResult({ status: "idle" });
    setStep(next);
  }

  function toggleType(type: string) {
    setTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  // "Pick again" passes the games already shown so the next three are different.
  async function findGames(exclude: string[] = []) {
    setResult({ status: "loading" });
    setChosenId(null);

    try {
      const data = await api<{ recommendations: Recommendation[] }>("/api/recommendations", {
        method: "POST",
        body: { availableTime: time, genres: types, gameMode: mode, exclude },
      });

      if (data.recommendations.length === 0 && exclude.length > 0) {
        // Every match has been shown. The next press starts from the top.
        setSeen([]);
        setResult({ status: "exhausted" });
        return;
      }

      setSeen([...exclude, ...data.recommendations.map((game) => game.id)]);
      setResult({ status: "ready", games: data.recommendations });
    } catch (error) {
      setResult(
        error instanceof ApiError && error.code === "EMPTY_LIBRARY"
          ? { status: "empty-library" }
          : { status: "error", message: errorMessage(error) },
      );
    }
  }

  // Short summary of each answer, in question order.
  // Saves the choice so later picks can learn from it. The on-screen state
  // does not wait for this, and a failure only means this pick is not remembered.
  function choose(gameId: string) {
    setChosenId(gameId);
    api(`/api/library/${encodeURIComponent(gameId)}/picks`, {
      method: "POST",
      body: { availableTime: time },
    }).catch(() => {});
  }

  const answers = [
    TIMES.find((option) => option.value === time)?.label ?? "Any",
    types.length === 0 ? "Anything" : types.join(", "),
    MODES.find((option) => option.value === mode)?.label ?? "Either",
  ];

  if (asking) {
    return (
      <form
        className="mx-auto flex max-w-4xl flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (lastStep) findGames();
          else goTo(step + 1);
        }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="pixel-label text-muted">Pick a game</h1>
          <p className="pixel-label text-forest">
            Question {step + 1} of {STEP_COUNT}
          </p>
        </div>
        <div aria-hidden="true" className="mt-3 grid grid-cols-3 gap-2">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <span
              key={index}
              className={`h-3 ${index < step ? "bg-forest" : index === step ? "bg-emerald" : "bg-fern"}`}
            />
          ))}
        </div>

        {step > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-muted">So far:</span>
            {answers.slice(0, step).map((answer, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goTo(index)}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 bg-surface px-3.5 font-semibold text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
              >
                {answer}
                <span className="font-normal text-pine underline underline-offset-4">Change</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-12">
          {step === 0 && (
            <fieldset className="min-w-0">
              <legend ref={questionRef} tabIndex={-1} className={legend}>
                How much time do you have?
              </legend>
              <p className={helper}>A rough guess is fine.</p>
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
          )}

          {step === 1 && (
            <fieldset className="min-w-0">
              <legend ref={questionRef} tabIndex={-1} className={legend}>
                What sounds good?
              </legend>
              <p className={helper}>
                Choose any that fit. Leave them all off and PlayState considers everything.
                {narrowed && " Only types found in your library are shown."}
              </p>
              <div className={tiles}>
                {offeredTypes.map((type) => (
                  <OptionTile
                    key={type}
                    detail={
                      typeCounts && typeCounts[type] > 0
                        ? `${typeCounts[type]} ${typeCounts[type] === 1 ? "game" : "games"}`
                        : undefined
                    }
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
          )}

          {step === 2 && (
            <fieldset className="min-w-0">
              <legend ref={questionRef} tabIndex={-1} className={legend}>
                How do you want to play?
              </legend>
              <p className={helper}>Alone, with others, or no preference.</p>
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
          )}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-5 border-t-4 border-dotted border-fern px-1 pb-3 pt-7">
          {step > 0 ? (
            <button type="button" onClick={() => goTo(step - 1)} className="btn btn-secondary btn-lg">
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-5">
            {step === 1 && types.length > 0 && (
              <span className="text-muted">{types.length} chosen</span>
            )}
            <button type="submit" className="btn btn-primary btn-lg">
              {lastStep ? "Find games" : "Next"}
            </button>
          </div>
        </div>
      </form>
    );
  }

  const games = result.status === "ready" ? result.games : [];
  const heading =
    result.status === "exhausted"
      ? "That is all of them"
      : games.length === 3 ? "Your three picks" : games.length === 1 ? "Your pick" : "Your picks";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1
            ref={resultsRef}
            tabIndex={-1}
            className="font-pixel text-6xl leading-[0.9] text-forest outline-none"
          >
            {heading}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-muted">For:</span>
            {answers.map((answer, index) => (
              <span key={index} className={chip}>
                {answer}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-5 px-1 pb-3">
          <button type="button" onClick={() => goTo(0)} className="btn btn-secondary">
            Change answers
          </button>
          {(result.status === "ready" || result.status === "exhausted") && (
            <button type="button" onClick={() => findGames(seen)} className="btn btn-primary">
              Pick again
            </button>
          )}
          {result.status === "error" && (
            <button type="button" onClick={() => findGames()} className="btn btn-primary">
              Try again
            </button>
          )}
        </div>
      </div>

      <section className="mt-8" aria-live="polite">
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

        {result.status === "exhausted" && (
          <Notice tone="info">
            You have seen every game in your library that fits these answers. Pick again starts
            from the top.
          </Notice>
        )}

        {result.status === "ready" && games.length === 0 && (
          <Notice tone="info">
            Nothing in your library fits that. Choose Change answers, then try fewer game types or
            set how you want to play to Either.
          </Notice>
        )}

        {games.length > 0 && (
          <ol className="grid gap-7 px-1 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game, index) => {
              const chosen = chosenId === game.id;

              return (
                <li
                  key={game.id}
                  className={`flex flex-col gap-4 p-5 pixel-frame ${
                    chosen ? "bg-mint" : chosenId ? "bg-surface opacity-55" : "bg-surface"
                  }`}
                >
                  <div className="relative">
                    <GameCover title={game.title} coverUrl={game.coverUrl} />
                    <span className="absolute left-3 top-3 bg-emerald px-2 font-pixel text-xl leading-tight text-forest">
                      PICK {index + 1}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold leading-snug text-forest">{game.title}</h2>
                    <p className="mt-1 text-muted">{genreLine(game.genres, 3)}</p>
                  </div>

                  <div>
                    <p className="pixel-label text-forest">Why this fits</p>
                    <ul className="mt-2 space-y-1 text-slate">
                      {game.reasons.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span aria-hidden="true" className="font-bold text-pine">
                            +
                          </span>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-auto px-1 pt-2">
                    {chosen ? (
                      <p
                        role="status"
                        className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 text-lg font-bold text-forest"
                      >
                        Locked in. Have fun.
                        <Link
                          href={`/library/${game.id}`}
                          className="text-base font-semibold underline underline-offset-4 hover:no-underline"
                        >
                          View game
                        </Link>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => choose(game.id)}
                        aria-label={`Choose ${game.title}`}
                        className="btn btn-secondary w-full"
                      >
                        Choose this
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
