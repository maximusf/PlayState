"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ApiError,
  errorMessage,
  useApi,
  type PartyDetail,
  type PartyInvite,
} from "@/lib/api";
import { genreLine } from "@/lib/genres";
import { PartySkeleton } from "@/components/skeletons";
import { CountedInput, EmptyState, GameCover, Notice } from "@/components/ui";
import { expires, players } from "../parties-view";

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "invite"; invite: PartyInvite }
  | { status: "ready"; party: PartyDetail };

const backLink =
  "inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4 hover:no-underline";
const coverLift =
  "transition duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_8px_0_0_var(--color-forest)] group-focus-visible:-translate-y-1 group-focus-visible:shadow-[0_8px_0_0_var(--color-forest)]";
const dangerLink =
  "min-h-11 cursor-pointer px-2 font-semibold text-danger underline underline-offset-4 hover:no-underline disabled:opacity-60";
const plainLink =
  "min-h-11 cursor-pointer font-semibold text-forest underline underline-offset-4 hover:no-underline disabled:opacity-60";
const chipButton =
  "min-h-11 cursor-pointer underline underline-offset-4 hover:no-underline disabled:opacity-60";
const row = "flex items-center gap-4 bg-surface p-3 pixel-frame [--frame:var(--color-fern)]";

// IGDB marks some games with a placeholder for "no real limit". Those show no limit at all.
const NO_REAL_LIMIT = 100;

function playerLimit(maxPlayers: number | null): string | null {
  return maxPlayers === null || maxPlayers >= NO_REAL_LIMIT ? null : `Up to ${players(maxPlayers)}`;
}

function GameRow({
  game,
  note,
}: {
  game: { title: string; coverUrl: string | null; genres: string[] };
  note: string;
}) {
  return (
    <li className={row}>
      <GameCover title={game.title} coverUrl={game.coverUrl} className="w-12 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-bold leading-snug text-forest">
          {game.title}
        </span>
        <span className="block truncate text-sm text-muted">{genreLine(game.genres, 3)}</span>
      </span>
      <span className="shrink-0 text-right text-sm font-semibold text-forest">{note}</span>
    </li>
  );
}

function PartyGames({ party }: { party: PartyDetail }) {
  const alone = party.memberCount === 1;
  // A game whose limit is unknown is kept in the main list. Only a known, too-low limit moves it.
  const fits = party.shared.filter(
    (game) => game.maxPlayers === null || game.maxPlayers >= party.memberCount,
  );
  const tooSmall = party.shared.filter(
    (game) => game.maxPlayers !== null && game.maxPlayers < party.memberCount,
  );

  return (
    <>
      <section className="mt-10">
        <h2 className="font-pixel text-4xl leading-none text-forest">
          {alone ? "Your multiplayer games" : "Everyone owns"}
        </h2>
        <p className="mt-2 text-muted">
          {alone
            ? "Send the invite link to a friend to see which of these you share."
            : `Multiplayer games in all ${party.memberCount} libraries.`}
        </p>

        {fits.length === 0 ? (
          <div className="mt-5">
            <Notice tone="info">
              {alone
                ? "You have no multiplayer games in your library yet."
                : tooSmall.length > 0
                  ? "Every game you all own is too small for this group. They are listed below."
                  : "No multiplayer game is in every library yet. Adding or importing more games may turn some up."}
            </Notice>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 px-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {fits.map((game) => {
              const limit = playerLimit(game.maxPlayers);
              const card = (
                <>
                  <span
                    className={`relative block ring-4 ring-forest group-hover:ring-emerald group-focus-visible:ring-emerald ${coverLift}`}
                  >
                    <GameCover title={game.title} coverUrl={game.coverUrl} />
                  </span>
                  <span>
                    <span className="block text-lg font-bold leading-snug text-forest">
                      {game.title}
                    </span>
                    <span className="block text-sm text-muted">{genreLine(game.genres)}</span>
                    {limit && <span className="block text-sm text-muted">{limit}</span>}
                  </span>
                </>
              );

              return (
                <li key={game.igdbId}>
                  {game.libraryEntryId ? (
                    <Link
                      href={`/library/${game.libraryEntryId}`}
                      className="group flex flex-col gap-3 outline-offset-8"
                    >
                      {card}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-3">{card}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {tooSmall.length > 0 && (
        <section className="mt-12">
          <h2 className="font-pixel text-4xl leading-none text-forest">Too small for this group</h2>
          <p className="mt-2 text-muted">
            Everyone owns these, but they hold fewer than {players(party.memberCount)}.
          </p>
          <ul className="mt-6 space-y-4 px-1">
            {tooSmall.map((game) => (
              <GameRow key={game.igdbId} game={game} note={playerLimit(game.maxPlayers) ?? ""} />
            ))}
          </ul>
        </section>
      )}

      {party.almost.length > 0 && (
        <section className="mt-12">
          <h2 className="font-pixel text-4xl leading-none text-forest">Almost</h2>
          <p className="mt-2 text-muted">One player short of a full set.</p>
          <ul className="mt-6 space-y-4 px-1">
            {party.almost.map((game) => (
              <GameRow key={game.igdbId} game={game} note={`${game.missing} needs this one`} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function PartyView({ code }: { code: string }) {
  const api = useApi();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Ending a party, or leaving it as host, changes it for everyone, so both are confirmed first.
  const [confirming, setConfirming] = useState<"leave" | "end" | null>(null);
  // Host controls: the new name being typed, and the member about to be removed.
  const [newName, setNewName] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const path = `/api/parties/${encodeURIComponent(code)}`;

  useEffect(() => {
    let cancelled = false;

    // The invite says whether this player has joined. Only members can load the party itself.
    api<PartyInvite>(`${path}/invite`)
      .then(async (invite): Promise<State> =>
        invite.joined
          ? { status: "ready", party: await api<PartyDetail>(path) }
          : { status: "invite", invite },
      )
      .then(
        (next) => {
          if (!cancelled) setState(next);
        },
        (error) => {
          if (cancelled) return;
          setState(
            error instanceof ApiError && (error.status === 404 || error.status === 400)
              ? { status: "missing" }
              : { status: "error", message: errorMessage(error) },
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, [api, path, reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  async function join(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!displayName.trim()) {
      setActionError("Enter a nickname to join.");
      return;
    }

    setJoining(true);
    setActionError(null);

    try {
      await api(`${path}/members`, { method: "POST", body: { displayName } });
      reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setJoining(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setActionError("The link could not be copied. Copy it from the address bar instead.");
    }
  }

  async function rename(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || newName === null) return;

    if (!newName.trim()) {
      setActionError("Give the party a name.");
      return;
    }

    setBusy(true);
    setActionError(null);

    try {
      const { name } = await api<{ name: string }>(path, { method: "PATCH", body: { name: newName } });
      setState({ status: "ready", party: { ...state.party, name } });
      setNewName(null);
    } catch (error) {
      setActionError(`The party was not renamed. ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string) {
    setBusy(true);
    setActionError(null);

    try {
      await api(`${path}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
      setRemovingId(null);
      // The shared games change when someone goes, so the party is loaded again.
      reload();
    } catch (error) {
      setActionError(`That player was not removed. ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  // Ending deletes the party for everyone. Leaving takes only this player out of it.
  async function leaveOrEnd(end: boolean) {
    setLeaving(true);
    setActionError(null);

    try {
      await api(end ? path : `${path}/members/me`, { method: "DELETE" });
      router.push("/party");
    } catch (error) {
      setActionError(
        `${end ? "The party was not ended." : "You are still in this party."} ${errorMessage(error)}`,
      );
      setLeaving(false);
      setConfirming(null);
    }
  }

  // Who takes over if the host leaves: the player who has been in the party longest.
  // The API lists members in the order they joined.
  const nextHost =
    state.status === "ready" && state.party.isHost
      ? (state.party.members.find((member) => !member.isYou) ?? null)
      : null;

  return (
    <div>
      <Link href="/party" className={backLink}>
        Back to your parties
      </Link>

      <div className="mt-5">
        {state.status === "loading" && <PartySkeleton label="Loading party" />}

        {state.status === "error" && (
          <div className="space-y-4">
            <Notice tone="error">{state.message}</Notice>
            <button type="button" onClick={reload} className="btn btn-secondary mx-1">
              Try again
            </button>
          </div>
        )}

        {state.status === "missing" && (
          <div className="px-1">
            <EmptyState
              title="That party is not here."
              action={
                <Link href="/party" className="btn btn-primary mb-2">
                  Start a party
                </Link>
              }
            >
              Parties last one day, so it may have expired or been ended by its host. The link may
              also be mistyped.
            </EmptyState>
          </div>
        )}

        {state.status === "invite" && state.invite.removed && (
          <div className="mx-auto max-w-md">
            <Notice tone="info">
              The host removed you from {state.invite.name}, so this link no longer lets you in.
            </Notice>
          </div>
        )}

        {state.status === "invite" && !state.invite.removed && (
          <form onSubmit={join} className="mx-auto max-w-md space-y-5 bg-surface p-6 pixel-frame">
            <div>
              <p className="pixel-label text-pine">You are invited to</p>
              <h1 className="mt-3 font-pixel text-6xl leading-[0.9] text-forest">
                {state.invite.name}
              </h1>
              <p className="mt-2 text-muted">
                {players(state.invite.memberCount)} so far. {expires(state.invite.expiresAt)}.
              </p>
            </div>
            <p className="text-slate">
              Joining shows the party which multiplayer games you have in common. The rest of your
              library stays private.
            </p>
            <div>
              <label htmlFor="join-display-name" className="pixel-label text-muted">
                Your nickname
              </label>
              <div className="mt-3">
                <CountedInput
                  id="join-display-name"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="What friends call you"
                  autoComplete="nickname"
                  maxLength={24}
                  className="min-h-11 w-full min-w-0 bg-surface px-3 text-forest ring-2 ring-fern ring-inset placeholder:text-muted/70"
                />
              </div>
            </div>
            {actionError && <Notice tone="error">{actionError}</Notice>}
            <div className="px-1 pb-2">
              <button type="submit" disabled={joining} className="btn btn-primary">
                {joining ? "Joining" : "Join party"}
              </button>
            </div>
          </form>
        )}

        {state.status === "ready" && (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="pixel-label text-pine">Party</p>
                {newName === null ? (
                  <>
                    <h1 className="mt-3 font-pixel text-6xl leading-[0.9] text-forest">
                      {state.party.name}
                    </h1>
                    <p className="mt-2 flex flex-wrap items-center gap-x-4 text-muted">
                      {expires(state.party.expiresAt)}
                      {state.party.isHost && (
                        <button
                          type="button"
                          onClick={() => setNewName(state.party.name)}
                          className={plainLink}
                        >
                          Rename
                        </button>
                      )}
                    </p>
                  </>
                ) : (
                  <form onSubmit={rename} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label htmlFor="party-rename" className="sr-only">
                      Party name
                    </label>
                    <div className="w-72 max-w-full">
                      <CountedInput
                        id="party-rename"
                        type="text"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        autoComplete="off"
                        maxLength={40}
                        autoFocus
                        className="min-h-11 w-full min-w-0 bg-surface px-3 text-forest ring-2 ring-fern ring-inset"
                      />
                    </div>
                    <button type="submit" disabled={busy} className={plainLink}>
                      {busy ? "Saving" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewName(null)}
                      disabled={busy}
                      className={plainLink}
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </div>
              <div className="px-1 pb-3">
                <button type="button" onClick={copyLink} className="btn btn-primary">
                  {copied ? "Link copied" : "Copy invite link"}
                </button>
              </div>
            </div>

            <ul aria-label="Players in this party" className="mt-6 flex flex-wrap gap-2">
              {state.party.members.map((member) => (
                <li
                  key={member.id}
                  className={`flex min-h-11 items-center gap-3 px-3 text-[0.9375rem] font-semibold ${
                    member.isYou
                      ? "bg-forest text-surface"
                      : "bg-surface text-forest ring-2 ring-fern ring-inset"
                  }`}
                >
                  {removingId === member.id ? (
                    <>
                      <span role="status">Remove {member.displayName}?</span>
                      <button
                        type="button"
                        onClick={() => removeMember(member.id)}
                        disabled={busy}
                        className={`${chipButton} text-danger`}
                      >
                        {busy ? "Removing" : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemovingId(null)}
                        disabled={busy}
                        className={chipButton}
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      <span>
                        {member.displayName}
                        {member.isYou && " (you)"}
                        {member.isHost && !member.isYou && " (host)"}
                      </span>
                      {/* Only the host sees this, and never on their own name. */}
                      {state.party.isHost && !member.isYou && (
                        <button
                          type="button"
                          onClick={() => setRemovingId(member.id)}
                          className={`${chipButton} text-danger`}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>

            {actionError && (
              <div className="mt-6">
                <Notice tone="error">{actionError}</Notice>
              </div>
            )}

            <PartyGames party={state.party} />

            <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t-4 border-dotted border-fern pt-4">
              {confirming === null && (
                <>
                  {/* A host who is alone has nobody to hand the party to, so they can only end it. */}
                  {(!state.party.isHost || nextHost) && (
                    <button
                      type="button"
                      onClick={() => (state.party.isHost ? setConfirming("leave") : leaveOrEnd(false))}
                      disabled={leaving}
                      className={dangerLink}
                    >
                      {leaving ? "Leaving" : "Leave party"}
                    </button>
                  )}
                  {state.party.isHost && (
                    <button type="button" onClick={() => setConfirming("end")} className={dangerLink}>
                      End party
                    </button>
                  )}
                </>
              )}

              {confirming !== null && (
                <>
                  <p role="status" className="font-semibold text-forest">
                    {confirming === "leave"
                      ? `Leave this party? ${nextHost?.displayName} will become the host.`
                      : `End this party for all ${players(state.party.memberCount)}?`}
                  </p>
                  <button
                    type="button"
                    onClick={() => leaveOrEnd(confirming === "end")}
                    disabled={leaving}
                    className={dangerLink}
                  >
                    {leaving ? "Working" : confirming === "leave" ? "Yes, leave" : "Yes, end it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={leaving}
                    className={plainLink}
                  >
                    {confirming === "leave" ? "Stay" : "Keep it"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
