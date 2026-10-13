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
  type PartyRoll,
  type PartySettings,
} from "@/lib/api";
import { useDiceRoll } from "@/lib/use-dice-roll";
import { PixelIcon } from "@/components/pixel-icons";
import { WinnerTrace } from "@/components/winner-trace";
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
// Leaving and ending are buttons like the rest, marked out by red text.
const dangerLink = "btn btn-secondary text-danger";
const plainLink =
  "min-h-11 cursor-pointer font-semibold text-forest underline underline-offset-4 hover:no-underline disabled:opacity-60";
const chipButton =
  "min-h-11 cursor-pointer underline underline-offset-4 hover:no-underline disabled:opacity-60";

// IGDB marks some games with a placeholder for "no real limit". Those show no limit at all.
const NO_REAL_LIMIT = 100;

function playerLimit(maxPlayers: number | null): string | null {
  return maxPlayers === null || maxPlayers >= NO_REAL_LIMIT ? null : `Up to ${players(maxPlayers)}`;
}

// One colour per player. A party holds at most twelve, so nobody has to share.
const MEMBER_COLOURS = [
  "#e11d48",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#059669",
  "#0d9488",
  "#0284c7",
  "#2563eb",
  "#7c3aed",
  "#c026d3",
  "#db2777",
  "#57534e",
];

// Gives each member a colour that looks random but is worked out from their member ID, so
// everyone in the party sees the same colours and they survive a reload. Members are taken
// in the order they joined. If two would land on the same colour, the later one moves along.
function colourMembers(members: { id: string }[]): Map<string, string> {
  const colours = new Map<string, string>();
  const taken = new Set<number>();

  for (const member of members) {
    let hash = 0;
    for (const character of member.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;

    let index = hash % MEMBER_COLOURS.length;
    while (taken.has(index) && taken.size < MEMBER_COLOURS.length) {
      index = (index + 1) % MEMBER_COLOURS.length;
    }

    taken.add(index);
    colours.set(member.id, MEMBER_COLOURS[index]);
  }

  return colours;
}

// How often an open party page checks whether anything has changed.
const LIVE_CHECK_MS = 4000;

type Tile = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  // True for a game the whole party owns and can fit in. Everything else is greyed out.
  playable: boolean;
  note: string | null;
};

function PartyGames({
  party,
  path,
  onChanged,
}: {
  party: PartyDetail;
  path: string;
  // Called with whatever the server says changed, so the page shows it straight away.
  onChanged: (changes: PartyRoll | PartySettings) => void;
}) {
  const api = useApi();
  const alone = party.memberCount === 1;
  const [sending, setSending] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  // One setting for the whole party, changed only by the host.
  const ignoreLimits = party.ignoreLimits;
  const [savingLimits, setSavingLimits] = useState(false);

  async function setIgnoreLimits(value: boolean) {
    setSavingLimits(true);
    setRollError(null);

    try {
      onChanged(await api<PartySettings>(path, { method: "PATCH", body: { ignoreLimits: value } }));
    } catch (error) {
      setRollError(`That setting was not saved. ${errorMessage(error)}`);
    } finally {
      setSavingLimits(false);
    }
  }

  // A game whose player limit is unknown counts as playable. Only a known, too-low limit rules
  // it out, and the party can choose to ignore limits, since they are sometimes wrong and a
  // mod can raise them.
  const tooSmall = (game: { maxPlayers: number | null }) =>
    game.maxPlayers !== null && game.maxPlayers < party.memberCount;
  const overLimit = party.shared.filter(tooSmall);

  const tiles: Tile[] = [
    ...party.shared
      .filter((game) => ignoreLimits || !tooSmall(game))
      .map((game) => ({ ...game, playable: true, note: playerLimit(game.maxPlayers) })),
    ...party.shared
      .filter((game) => !ignoreLimits && tooSmall(game))
      .map((game) => ({ ...game, playable: false, note: playerLimit(game.maxPlayers) })),
    ...party.almost.map((game) => ({
      ...game,
      playable: false,
      note: game.missingIsYou ? "You need this one" : `${game.missing} needs this one`,
    })),
    ...party.others.map((game) => ({ ...game, playable: false, note: null })),
  ];
  const playable = tiles.filter((tile) => tile.playable);
  const sharedIds = party.shared.map((game) => game.igdbId);
  const dice = useDiceRoll(sharedIds);
  const rolling = dice.rolling || sending;
  // While the dice hops, the cover it is on. Otherwise the roll saved on the party, which is
  // the same for every member. A saved roll for a game no longer shared is not shown.
  const saved =
    party.rolledIgdbId !== null && sharedIds.includes(party.rolledIgdbId) ? party.rolledIgdbId : null;
  const rolledId = dice.rolling ? dice.rolled : saved;
  const rolled = party.shared.find((game) => game.igdbId === rolledId) ?? null;
  // The dice button shows only an icon, so its meaning is spelled out for hover and screen readers.
  const diceLabel = dice.rolling
    ? "Skip to the result"
    : sending
      ? "Rolling"
      : rolled
        ? "Roll the dice again"
        : "Roll the dice to choose a game for the party";

  // The host's browser chooses, the server checks and saves it, and only then does the dice
  // play out, landing on the saved game. Every other member sees it within a few seconds.
  async function roll() {
    const pool = playable.map((tile) => tile.igdbId);
    // A fresh roll never repeats the last one when there is another choice.
    const fresh = pool.filter((igdbId) => igdbId !== saved);
    const from = fresh.length > 0 ? fresh : pool;
    const target = from[Math.floor(Math.random() * from.length)];

    setSending(true);
    setRollError(null);

    try {
      onChanged(await api<PartyRoll>(`${path}/roll`, { method: "POST", body: { igdbId: target } }));
      dice.roll(pool, target);
    } catch (error) {
      setRollError(`The roll was not saved. ${errorMessage(error)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h2 className="font-pixel text-4xl leading-none text-forest">
          {alone ? "Your multiplayer games" : "Games"}
        </h2>
        {/* Only the host rolls. Everyone else sees a note in its place, so they know to ask. */}
        {playable.length > 1 && party.isHost && (
          <span className="px-1 pb-2">
            <button
              type="button"
              // Pressing it again while the dice is hopping skips to the result.
              onClick={dice.rolling ? dice.skip : roll}
              disabled={sending}
              aria-label={diceLabel}
              title={diceLabel}
              className="btn btn-primary w-11 px-0"
            >
              <PixelIcon name="dice" className="size-6" />
            </button>
          </span>
        )}
        {playable.length > 1 && !party.isHost && (
          <p className="flex items-center gap-2 text-muted">
            <PixelIcon name="dice" className="size-6" />
            The host rolls the dice.
          </p>
        )}
      </div>
      {alone && (
        <p className="mt-2 text-muted">
          Send the invite link to a friend to see which of these you share.
        </p>
      )}

      {/* The host's setting for the whole party, with a note on what it would change. */}
      {party.shared.length > 0 && party.isHost && (
        <label className="mt-4 flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 font-semibold text-forest">
          <input
            type="checkbox"
            checked={ignoreLimits}
            onChange={(event) => setIgnoreLimits(event.target.checked)}
            disabled={rolling || savingLimits}
            className="size-6 shrink-0 cursor-pointer accent-emerald"
          />
          Ignore player limits for everyone
          <span className="font-normal text-muted">
            {overLimit.length === 0
              ? "No shared game is over its limit right now"
              : `Adds ${overLimit.length} ${overLimit.length === 1 ? "game" : "games"} too small for ${players(party.memberCount)}`}
          </span>
        </label>
      )}

      {/* Everyone else is told when the host has switched limits off. */}
      {ignoreLimits && !party.isHost && (
        <p className="mt-4 text-muted">The host is ignoring player limits for this party.</p>
      )}

      {rollError && (
        <div className="mt-4">
          <Notice tone="error">{rollError}</Notice>
        </div>
      )}

      {/* Read out once the dice has settled, not on every hop. */}
      <p role="status" className="sr-only">
        {rolled && !rolling ? `The dice picked ${rolled.title}.` : ""}
      </p>

      {rolled && !rolling && (
        <p className="mt-5 bg-emerald px-4 py-3 text-lg font-bold text-forest pixel-frame mx-1">
          The dice picked {rolled.title}.
        </p>
      )}

      {tiles.length === 0 && (
        <div className="mt-5">
          <Notice tone="info">
            You have no multiplayer games in your library yet. Add or import some to compare.
          </Notice>
        </div>
      )}

      {tiles.length > 0 && playable.length === 0 && (
        <div className="mt-5">
          <Notice tone="info">
            No multiplayer game works for everyone yet. The greyed-out games below show how close
            each one is.
          </Notice>
        </div>
      )}

      {tiles.length > 0 && (
        <ul className="mt-6 grid grid-cols-3 gap-x-4 gap-y-5 px-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
          {tiles.map((tile) => {
            const isRolled = tile.igdbId === rolledId;
            // Colour means a game the party shares. Alone there is nobody to share with, so every
            // game starts grey, and the dice brings each one to colour as it lands on it.
            const coloured = isRolled || (tile.playable && !alone);

            return (
              <li key={tile.igdbId} className="group flex flex-col gap-2">
                {/* Hovering lifts a cover, like in the library. The dice lifts its pick the same way. */}
                {/* While the dice is rolling nothing pops out: no lift on hover, and none on the
                    cover the dice is passing over. The lift is kept for where it settles. */}
                <span
                  className={`relative block ring-4 transition duration-150 ease-out ${
                    rolling
                      ? ""
                      : "group-hover:-translate-y-1 group-hover:shadow-[0_8px_0_0_var(--color-forest)]"
                  } ${
                    isRolled
                      ? // Passing over: a green outline. Settled: the lift, and the gold trace in its place.
                        rolling
                        ? "ring-emerald"
                        : "-translate-y-1 shadow-[0_8px_0_0_var(--color-forest)] ring-transparent"
                      : coloured
                        ? `ring-forest ${rolling ? "" : "group-hover:ring-emerald"}`
                        : `ring-fern/60 ${rolling ? "" : "group-hover:ring-forest"}`
                  }`}
                >
                  <GameCover
                    title={tile.title}
                    coverUrl={tile.coverUrl}
                    className={`transition duration-100 ease-out ${
                      coloured
                        ? ""
                        : `opacity-35 grayscale ${
                            rolling ? "" : "group-hover:opacity-100 group-hover:grayscale-0"
                          }`
                    }`}
                  />
                  {isRolled && !rolling && <WinnerTrace />}
                </span>
                <span>
                  <span
                    className={`line-clamp-2 text-sm font-bold leading-snug ${
                      coloured ? "text-forest" : "text-muted"
                    }`}
                  >
                    {tile.title}
                  </span>
                  {tile.note && <span className="block text-xs text-muted">{tile.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

  // Keeps the page current without a refresh. Every few seconds it asks for the party's
  // version, a cheap check, and loads the party again only when that has changed: someone
  // joined or left, the host rolled or renamed it.
  const version = state.status === "ready" ? state.party.version : null;

  useEffect(() => {
    if (version === null) return;
    let cancelled = false;
    let checking = false;

    const timer = setInterval(async () => {
      // No checks while the tab is in the background, or while the last one is still running.
      if (document.hidden || checking) return;
      checking = true;

      try {
        const latest = await api<{ version: string }>(`${path}/version`);
        if (cancelled || latest.version === version) return;

        const party = await api<PartyDetail>(path);
        if (!cancelled) setState({ status: "ready", party });
      } catch (error) {
        // Removed, ended or expired: load from the top, which shows the right message.
        // Anything else, such as a dropped connection, is tried again on the next check.
        if (!cancelled && error instanceof ApiError && [403, 404].includes(error.status)) {
          setState({ status: "loading" });
          setReloadKey((key) => key + 1);
        }
      } finally {
        checking = false;
      }
    }, LIVE_CHECK_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, path, version]);

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
      const changes = await api<PartySettings>(path, { method: "PATCH", body: { name: newName } });
      setState({ status: "ready", party: { ...state.party, ...changes } });
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

  const memberColours = colourMembers(state.status === "ready" ? state.party.members : []);

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
              {/* One row of actions: share the party, then the ways out of it. */}
              <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-4 px-1 pb-3">
                <button type="button" onClick={copyLink} className="btn btn-primary">
                  {copied ? "Link copied" : "Copy invite link"}
                </button>
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
                        className="btn btn-secondary"
                      >
                        {confirming === "leave" ? "Stay" : "Keep it"}
                      </button>
                    </>
                  )}
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
                  {/* A little person in this member's own colour. It sits on a light tile so the
                      colour reads the same on the dark name tag and the light ones. */}
                  <span
                    className="inline-flex size-7 shrink-0 items-center justify-center bg-surface"
                    style={{ color: memberColours.get(member.id) }}
                  >
                    <PixelIcon name="singlePlayer" className="size-6" />
                  </span>
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

            <PartyGames
              party={state.party}
              path={path}
              onChanged={(changes) =>
                setState((current) =>
                  current.status === "ready"
                    ? { status: "ready", party: { ...current.party, ...changes } }
                    : current,
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
