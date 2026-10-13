"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useApi, type PartySummary } from "@/lib/api";
import { RowListSkeleton } from "@/components/skeletons";
import { CountedInput, Notice } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; parties: PartySummary[] };

const field =
  "min-h-11 w-full min-w-0 bg-surface px-3 text-forest ring-2 ring-fern ring-inset placeholder:text-muted/70";

export function players(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

const expiryFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
});

// When a party ends, in the reader's own time zone. Parties last one day.
export function expires(expiresAt: string): string {
  return `Expires ${expiryFormat.format(new Date(expiresAt))}`;
}

export function PartiesView() {
  const api = useApi();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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
        body: { name, displayName },
      });
      router.push(`/party/${party.code}`);
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-pixel text-6xl leading-[0.9] text-forest">Play together</h1>
      <p className="mt-4 text-lg text-slate">
        Start a party, send your friends the link, and see the multiplayer games you all own. A
        party lasts one day, and you can host three at a time.
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
        <h2 className="font-pixel text-4xl leading-none text-forest">Your parties</h2>
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
              {state.parties.map((party) => (
                <li key={party.code}>
                  <Link
                    href={`/party/${party.code}`}
                    className="flex items-center justify-between gap-4 bg-surface p-4 pixel-frame transition duration-200 ease-out [--frame:var(--color-fern)] hover:-translate-y-1 hover:[--frame:var(--color-emerald)] focus-visible:-translate-y-1 focus-visible:[--frame:var(--color-emerald)]"
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
