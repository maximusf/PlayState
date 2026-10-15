"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useApi, type PartySummary } from "@/lib/api";
import { RowListSkeleton } from "@/components/skeletons";
import { KebabMenu } from "@/components/kebab-menu";
import { CountedInput, Notice } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; parties: PartySummary[] };

// How many parties a player can be in at once. This matches MAX_PARTIES_PER_USER in the API.
const MAX_PARTIES = 3;

const field =
  "min-h-11 w-full min-w-0 bg-surface px-3 text-forest ring-2 ring-fern ring-inset placeholder:text-muted/70";

export function players(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

// Built on first use, in the browser, so it picks up the reader's own settings.
// Building it when this file loads could use the server's settings instead.
let expiryFormat: Intl.DateTimeFormat | null = null;
let longExpiryFormat: Intl.DateTimeFormat | null = null;

// How long a host can choose to keep a party for.
export const LIFETIMES = [
  { hours: 3, label: "3 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
];

// When a party ends, in the reader's own time zone and their 12 or 24 hour clock.
// The day name stays in English, like the rest of the site. A party that ends more than a
// day away also names the date, since the day name alone could mean this week or next.
export function expires(expiresAt: string): string {
  const hour12 = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
  const end = new Date(expiresAt);

  if (end.getTime() - Date.now() > 24 * 60 * 60 * 1000) {
    longExpiryFormat ??= new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12,
    });

    return `Expires ${longExpiryFormat.format(end)}`;
  }

  expiryFormat ??= new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12,
  });

  return `Expires ${expiryFormat.format(end)}`;
}

export function PartiesView() {
  const api = useApi();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [lifetimeHours, setLifetimeHours] = useState(24);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The party a Leave or End is waiting on a yes for, and any error from the last one.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openDialog() {
    setCreateError(null);
    dialogRef.current?.showModal();
  }

  useEffect(() => {
    let cancelled = false;

    api<PartySummary[]>("/api/parties").then(
      (parties) => {
        if (!cancelled) setState({ status: "ready", parties });
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api]);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim() || !displayName.trim()) {
      setCreateError("Give the party a name and enter a nickname.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const party = await api<PartySummary>("/api/parties", {
        method: "POST",
        body: { name, displayName, lifetimeHours },
      });
      router.push(`/party/${party.code}`);
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreating(false);
    }
  }

  // Ending deletes the party for everyone. Leaving takes only this player out of it.
  async function leaveOrEnd(party: PartySummary) {
    setWorking(true);
    setRowError(null);

    try {
      await api(party.isHost ? `/api/parties/${encodeURIComponent(party.code)}` : `/api/parties/${encodeURIComponent(party.code)}/members/me`, {
        method: "DELETE",
      });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", parties: current.parties.filter((item) => item.code !== party.code) }
          : current,
      );
      setConfirming(null);
    } catch (error) {
      setRowError(
        `${party.isHost ? "The party was not ended." : "You are still in that party."} ${errorMessage(error)}`,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-pixel text-6xl leading-[0.9] text-forest">Play together</h1>
      <p className="mt-4 text-lg text-slate">
        Start a party, send your friends the link, and see the multiplayer games you all own.{" "}
        <span aria-hidden="true">🎉</span>
      </p>

      <div className="mt-8 px-1 pb-3">
        <button type="button" onClick={openDialog} className="btn btn-primary btn-lg">
          Start a party
        </button>
      </div>

      {/* A native dialog: it traps focus, closes on Escape, and dims the page behind it. */}
      <dialog
        ref={dialogRef}
        aria-labelledby="start-party-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md border-0 bg-surface p-6 text-slate pixel-frame backdrop:bg-forest/60"
      >
        <form onSubmit={onSubmit} className="space-y-5">
          <h2 id="start-party-title" className="font-pixel text-4xl leading-none text-forest">
            Start a party
          </h2>
          <div>
            <label htmlFor="party-name" className="pixel-label text-muted">
              Party name
            </label>
            <div className="mt-3">
              <CountedInput
                id="party-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Friday night"
                autoComplete="off"
                maxLength={40}
                className={field}
              />
            </div>
          </div>
          <div>
            <label htmlFor="party-display-name" className="pixel-label text-muted">
              Your nickname
            </label>
            <div className="mt-3">
              <CountedInput
                id="party-display-name"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="What friends call you"
                autoComplete="nickname"
                maxLength={24}
                className={field}
              />
            </div>
          </div>
          <fieldset>
            <legend className="pixel-label text-muted">How long it lasts</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {LIFETIMES.map((option) => (
                <label
                  key={option.hours}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 font-semibold text-forest has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest ${
                    lifetimeHours === option.hours
                      ? "bg-mint ring-2 ring-forest ring-inset"
                      : "bg-surface ring-2 ring-fern ring-inset"
                  }`}
                >
                  <input
                    type="radio"
                    name="party-lifetime"
                    value={option.hours}
                    checked={lifetimeHours === option.hours}
                    onChange={() => setLifetimeHours(option.hours)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          {createError && <Notice tone="error">{createError}</Notice>}
          <div className="flex flex-wrap items-center gap-5 px-1 pb-2">
            <button type="submit" disabled={creating} className="btn btn-primary">
              {creating ? "Starting" : "Start party"}
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={creating}
              className="min-h-11 cursor-pointer px-2 font-semibold text-forest underline underline-offset-4 hover:no-underline disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>

      <section className="mt-10">
        <div className="flex items-center gap-4">
          <h2 className="font-pixel text-4xl leading-none text-forest">Your parties</h2>
          {state.status === "ready" && (
            <span
              role="img"
              aria-label={`In ${state.parties.length} of ${MAX_PARTIES} parties`}
              className={`pixel-label px-2 py-1 ring-2 ring-inset ${
                state.parties.length >= MAX_PARTIES ? "text-forest ring-forest" : "text-muted ring-fern"
              }`}
            >
              {state.parties.length}/{MAX_PARTIES}
            </span>
          )}
        </div>
        <div className="mt-5">
          {state.status === "loading" && (
            <RowListSkeleton label="Loading your parties" count={2} cover={false} />
          )}

          {state.status === "error" && <Notice tone="error">{state.message}</Notice>}

          {state.status === "ready" && state.parties.length === 0 && (
            <p className="text-muted">
              You are not in a party right now. Start one above, or open an invite link from a
              friend.
            </p>
          )}

          {state.status === "ready" && state.parties.length > 0 && (
            <ul className="space-y-4 px-1">
              {rowError && (
                <li>
                  <Notice tone="error">{rowError}</Notice>
                </li>
              )}
              {state.parties.map((party) => (
                <li key={party.code}>
                  {/* The menu sits beside the link, not inside it, so opening it never opens the party. */}
                  <div className="flex items-center gap-1 bg-surface pr-2 pixel-frame transition duration-200 ease-out [--frame:var(--color-fern)] focus-within:-translate-y-1 focus-within:[--frame:var(--color-emerald)] hover:-translate-y-1 hover:[--frame:var(--color-emerald)]">
                  <Link
                    href={`/party/${party.code}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 p-4"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="truncate text-lg font-bold text-forest">{party.name}</span>
                      {party.isHost && (
                        <span className="shrink-0 bg-forest px-2 py-0.5 text-sm font-semibold text-surface">
                          Host
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right text-sm text-muted">
                      <span className="block">{players(party.memberCount)}</span>
                      <span className="block">{expires(party.expiresAt)}</span>
                    </span>
                  </Link>
                  <KebabMenu
                    label={`Actions for ${party.name}`}
                    disabled={working}
                    items={[
                      {
                        label: party.isHost ? "End party" : "Leave party",
                        danger: true,
                        onSelect: () => {
                          setRowError(null);
                          setConfirming(party.code);
                        },
                      },
                    ]}
                  />
                  </div>
                  {confirming === party.code && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pb-2">
                      <p role="status" className="font-semibold text-forest">
                        {party.isHost
                          ? `End ${party.name} for all ${players(party.memberCount)}?`
                          : `Leave ${party.name}?`}
                      </p>
                      <button
                        type="button"
                        onClick={() => leaveOrEnd(party)}
                        disabled={working}
                        className="btn btn-secondary text-danger"
                      >
                        {working ? "Working" : party.isHost ? "Yes, end it" : "Yes, leave"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        disabled={working}
                        className="btn btn-secondary"
                      >
                        {party.isHost ? "Keep it" : "Stay"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
