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
  type PartyNominations,
  type PartyRoll,
  type PartySummary,
  type PartySettings,
} from "@/lib/api";
import { Dice3D, DICE_MS } from "@/components/dice-3d";
import { KebabMenu } from "@/components/kebab-menu";
import { PartyAvatar } from "@/components/party-avatar";
import { PartyChat } from "@/components/party-chat";
import { PartyBackdrop, PartyCustomise } from "@/components/party-customise";
import {
  NominatedBadge,
  NominateButton,
  NominationStrip,
  RollSourceNote,
  useNominations,
} from "@/components/party-nominate";
import { PartyReactions } from "@/components/party-reactions";
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
// Confirming a leave or an end is a button like the rest, marked out by red text.
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

// How often an open party page checks whether anything has changed. Short, so a roll reaches
// every member before the dice leaves the host's hand.
const LIVE_CHECK_MS = 2000;

// The pause between the host rolling and the dice being thrown. Every browser throws at the
// same moment, measured from the time the server saved the roll, so this gives the slowest
// member's next check time to hear about it first.
const ROLL_LEAD_MS = 2500;

type Tile = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  // True for a game the whole party owns and can fit in. Everything else is greyed out.
  playable: boolean;
  note: string | null;
};

// A roll being played out: the game it lands on, and how long until the throw. The wait is
// negative for a member who heard about the roll late, so they join it part way through.
type Throw = { igdbId: number; delayMs: number };

function PartyGames({
  party,
  path,
  colours,
  onChanged,
}: {
  party: PartyDetail;
  path: string;
  colours: Map<string, string>;
  // Called with whatever the server says changed, so the page shows it straight away.
  onChanged: (changes: PartyRoll | PartySettings | PartyNominations) => void;
}) {
  const api = useApi();
  const nominations = useNominations({ party, path, onChanged });
  const alone = party.memberCount === 1;
  const [sending, setSending] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  // One setting for the whole party, changed only by the host.
  const ignoreLimits = party.ignoreLimits;
  const [savingLimits, setSavingLimits] = useState(false);
  const [thrown, setThrown] = useState<Throw | null>(null);
  // The roll this page has already dealt with. A roll that is already there when the page
  // opens counts as seen, so only a roll made while watching plays the dice.
  const [seenRoll, setSeenRoll] = useState(party.rolledAt);

  // A new roll, whoever made it, plays once. The host sees it the same way as everyone else.
  if (party.rolledAt !== seenRoll) {
    setSeenRoll(party.rolledAt);

    // Both times are on the server's clock, so the two browsers' own clocks never meet.
    const delayMs =
      party.rolledAt === null ? 0 : Date.parse(party.rolledAt) + ROLL_LEAD_MS - Date.parse(party.serverNow);

    // No tumbling for players who have asked their device for less motion, or who heard about
    // the roll too late to catch any of it. They just see the result.
    if (
      party.rolledIgdbId !== null &&
      delayMs + DICE_MS > 0 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setThrown({ igdbId: party.rolledIgdbId, delayMs: Math.min(delayMs, ROLL_LEAD_MS) });
    }
  }

  // The dice clears itself a moment after it lands.
  useEffect(() => {
    if (!thrown) return;
    const timer = setTimeout(() => setThrown(null), thrown.delayMs + DICE_MS + 300);

    return () => clearTimeout(timer);
  }, [thrown]);

  function skipDice() {
    setThrown(null);
  }

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
  // it out, and the party can choose to include those anyway, since limits are sometimes wrong
  // and a mod can raise them.
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
  const throwing = thrown !== null;
  // The roll saved on the party, the same for every member. A saved roll for a game no longer
  // shared is not shown, and nothing is shown until the dice has landed.
  const saved =
    party.rolledIgdbId !== null && sharedIds.includes(party.rolledIgdbId) ? party.rolledIgdbId : null;
  const rolledId = throwing ? null : saved;
  const rolled = party.shared.find((game) => game.igdbId === rolledId) ?? null;
  const rolledNote = rolled ? playerLimit(rolled.maxPlayers) : null;
  // The dice button shows only an icon, so its meaning is spelled out for hover and screen readers.
  const diceLabel = throwing
    ? "The dice is rolling"
    : sending
      ? "Rolling"
      : rolled
        ? "Roll the dice again"
        : "Roll the dice to choose a game for the party";

  // The host's browser chooses and the server checks and saves it. Every browser, the host's
  // included, then plays the dice when it sees the saved roll, and lands on that game.
  async function roll() {
    // Two or more nominated games are the only ones the dice can land on, unless the host opts out.
    const pool = nominations.pool(playable.map((tile) => tile.igdbId));
    // A fresh roll never repeats the last one when there is another choice.
    const fresh = pool.filter((igdbId) => igdbId !== saved);
    const from = fresh.length > 0 ? fresh : pool;
    const target = from[Math.floor(Math.random() * from.length)];

    setSending(true);
    setRollError(null);

    try {
      onChanged(
        await api<PartyRoll>(`${path}/roll`, {
          method: "POST",
          body: { igdbId: target, fromAll: nominations.rollFromAll },
        }),
      );
      nominations.setRollFromAll(false);
    } catch (error) {
      setRollError(`The roll was not saved. ${errorMessage(error)}`);
    } finally {
      setSending(false);
    }
  }

  const limitsHelp =
    overLimit.length === 0
      ? `Group size is ${players(party.memberCount)}. Every shared game already fits.`
      : ignoreLimits
        ? `Group size is ${players(party.memberCount)}. Including ${overLimit.length} ${overLimit.length === 1 ? "game that lists" : "games that list"} fewer players.`
        : `Group size is ${players(party.memberCount)}. Turn this on to add ${overLimit.length} ${overLimit.length === 1 ? "game that lists" : "games that list"} fewer players.`;

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
              onClick={roll}
              disabled={sending || throwing}
              aria-label={diceLabel}
              title={diceLabel}
              className="btn btn-primary w-11 px-0"
            >
              <PixelIcon name="dice" className="size-6" />
            </button>
          </span>
        )}
        {playable.length > 1 && party.isHost && <RollSourceNote nominations={nominations} />}
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

      {/* The host's setting for the whole party. Everyone sees it, only the host can change it. */}
      {party.shared.length > 0 && !alone && (
        <div className="mt-4 flex items-start gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={ignoreLimits}
            aria-labelledby="limits-label"
            aria-describedby="limits-help"
            disabled={!party.isHost || throwing || savingLimits}
            onClick={() => setIgnoreLimits(!ignoreLimits)}
            className={`relative mt-1 h-7 w-12 shrink-0 cursor-pointer ring-2 ring-forest ring-inset disabled:cursor-default ${
              ignoreLimits ? "bg-emerald" : "bg-surface"
            } ${party.isHost ? "" : "opacity-60"}`}
          >
            {/* A square knob that slides to the right when the setting is on. */}
            <span
              aria-hidden="true"
              className={`absolute top-1 size-4 bg-forest transition-[left] duration-150 ${
                ignoreLimits ? "left-7" : "left-1"
              }`}
            />
          </button>
          <div>
            <p id="limits-label" className="font-semibold text-forest">
              Include games that don&apos;t fit our group size
            </p>
            <p id="limits-help" className="text-muted">
              {limitsHelp}
              {!party.isHost && " Only the host can change this."}
            </p>
          </div>
        </div>
      )}

      {playable.length > 0 && !alone && (
        <NominationStrip
          nominations={nominations}
          members={party.members}
          games={playable}
          colours={colours}
          isHost={party.isHost}
        />
      )}

      {(rollError ?? nominations.error) && (
        <div className="mt-4">
          <Notice tone="error">{rollError ?? nominations.error}</Notice>
        </div>
      )}

      {/* Read out once the dice has settled, not while it tumbles. */}
      <p role="status" className="sr-only">
        {rolled ? `Tonight's pick is ${rolled.title}.` : throwing ? "The dice is rolling." : ""}
      </p>

      {/* Every member sees the same dice at the same moment, then the same winner. */}
      {thrown && (
        <div className="mx-1 mt-6 flex flex-col items-center gap-6 bg-surface px-4 pb-8 pt-12 pixel-frame [--frame:var(--color-fern)]">
          <Dice3D face={(thrown.igdbId % 6) + 1} delayMs={thrown.delayMs} />
          <p className="pixel-label text-pine">Rolling for tonight&apos;s pick</p>
          <button type="button" onClick={skipDice} className={plainLink}>
            Skip to the result
          </button>
        </div>
      )}

      {rolled && (
        <div className="mx-1 mt-6 flex flex-col items-center gap-5 bg-surface p-5 pixel-frame [--frame:var(--color-emerald)] sm:flex-row sm:items-center sm:gap-8 sm:p-6">
          <span className="relative block w-44 shrink-0 ring-4 ring-forest sm:w-52">
            <GameCover title={rolled.title} coverUrl={rolled.coverUrl} eager />
            <WinnerTrace />
          </span>
          <div className="min-w-0 text-center sm:text-left">
            <p className="pixel-label text-pine">Tonight&apos;s pick</p>
            <h3 className="mt-3 break-words font-pixel text-5xl leading-[0.9] text-forest sm:text-6xl">
              {rolled.title}
            </h3>
            {rolled.genres.length > 0 && (
              <p className="mt-3 text-muted">{rolled.genres.slice(0, 3).join(", ")}</p>
            )}
            {rolledNote && <p className="text-muted">{rolledNote}</p>}
          </div>
        </div>
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
            // With a pick on show, every other game steps back so the winner stands alone.
            const dimmed = rolled !== null && !isRolled;
            // Colour means a game the party shares. Alone there is nobody to share with, so every
            // game starts grey.
            const coloured = tile.playable && !alone;

            return (
              <li
                key={tile.igdbId}
                className={`group flex flex-col gap-2 transition-opacity duration-200 ${
                  dimmed ? "opacity-40 hover:opacity-100 focus-within:opacity-100" : ""
                }`}
              >
                <span
                  className={`relative block ring-4 transition duration-150 ease-out ${
                    throwing ? "" : "group-hover:-translate-y-1 group-hover:shadow-[0_8px_0_0_var(--color-forest)]"
                  } ${
                    isRolled
                      ? "ring-emerald"
                      : coloured
                        ? `ring-forest ${throwing ? "" : "group-hover:ring-emerald"}`
                        : `ring-fern/60 ${throwing ? "" : "group-hover:ring-forest"}`
                  }`}
                >
                  <GameCover
                    title={tile.title}
                    coverUrl={tile.coverUrl}
                    className={`transition duration-100 ease-out ${
                      coloured || isRolled
                        ? ""
                        : `opacity-35 grayscale ${
                            throwing ? "" : "group-hover:opacity-100 group-hover:grayscale-0"
                          }`
                    }`}
                  />
                  <NominatedBadge
                    nominators={party.nominations.filter((n) => n.igdbId === tile.igdbId)}
                    colours={colours}
                  />
                </span>
                <span>
                  <span
                    className={`line-clamp-2 text-sm font-bold leading-snug ${
                      coloured || isRolled ? "text-forest" : "text-muted"
                    }`}
                  >
                    {tile.title}
                  </span>
                  {tile.note && <span className="block text-xs text-muted">{tile.note}</span>}
                </span>
                {tile.playable && !alone && (
                  <NominateButton
                    igdbId={tile.igdbId}
                    title={tile.title}
                    nominations={nominations}
                    disabled={throwing}
                  />
                )}
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
  const [showLink, setShowLink] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Leaving or ending a party is confirmed first, since neither can be undone.
  const [confirming, setConfirming] = useState<"leave" | "end" | null>(null);
  // Host controls: the new name being typed, and the member a remove or a hand-over is waiting on.
  const [newName, setNewName] = useState<string | null>(null);
  const [memberAction, setMemberAction] = useState<{ id: string; kind: "remove" | "host" } | null>(
    null,
  );
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

  // Clicking the invite field copies it. The field stays selected, so it can also be copied by hand.
  async function copyLink(field: HTMLInputElement) {
    field.select();

    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError("The link could not be copied. Copy it from the field instead.");
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
      setMemberAction(null);
      // The shared games change when someone goes, so the party is loaded again.
      reload();
    } catch (error) {
      setActionError(`That player was not removed. ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  // The host passes the party on and stays in it as an ordinary member.
  async function makeHost(memberId: string) {
    setBusy(true);
    setActionError(null);

    try {
      await api(`${path}/host`, { method: "POST", body: { memberId } });
      setMemberAction(null);
      reload();
    } catch (error) {
      setActionError(`The party was not handed over. ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  // Adds a day, once. The server says whether the party can still be extended.
  async function extend() {
    setBusy(true);
    setActionError(null);

    try {
      const changes = await api<PartySummary>(`${path}/extend`, { method: "POST" });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", party: { ...current.party, ...changes } }
          : current,
      );
    } catch (error) {
      setActionError(`The party was not extended. ${errorMessage(error)}`);
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
              Parties last a few hours to a week, so it may have expired or been ended by its host. The link may
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
            <PartyReactions code={code} />
            {/* The backdrop wraps everything down to the players list. */}
            <PartyBackdrop id={state.party.backdropId}>
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
                      {/* One extra day, once. After that the party says it has been extended. */}
                      {state.party.isHost && !state.party.extended && (
                        <button type="button" onClick={extend} disabled={busy} className={plainLink}>
                          Extend by a day
                        </button>
                      )}
                      {state.party.extended && <span>Extended</span>}
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
              {/* One row of actions: share the party, then the menu with the ways out of it. */}
              <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-4 px-1 pb-3">
                <button
                  type="button"
                  onClick={() => setShowLink((current) => !current)}
                  aria-expanded={showLink}
                  aria-controls="invite-link"
                  className="btn btn-primary"
                >
                  {showLink ? "Hide invite link" : "Show invite link"}
                </button>

                <PartyCustomise
                  party={state.party}
                  path={path}
                  colour={memberColours.get(state.party.members.find((m) => m.isYou)?.id ?? "")}
                  onChanged={(update) =>
                    setState((current) =>
                      current.status === "ready" ? { status: "ready", party: update(current.party) } : current,
                    )
                  }
                />

                {confirming === null ? (
                  <KebabMenu
                    label="Party actions"
                    disabled={leaving}
                    items={[
                      state.party.isHost
                        ? { label: "End party", danger: true, onSelect: () => setConfirming("end") }
                        : { label: "Leave party", danger: true, onSelect: () => setConfirming("leave") },
                    ]}
                  />
                ) : (
                  <>
                    <p role="status" className="font-semibold text-forest">
                      {confirming === "leave"
                        ? "Leave this party?"
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

            {/* The link is read-only. Clicking it copies it, so there is no separate copy button. */}
            {showLink && (
              <div id="invite-link" className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
                <label htmlFor="invite-link-field" className="sr-only">
                  Invite link. Click to copy.
                </label>
                <input
                  id="invite-link-field"
                  type="text"
                  readOnly
                  value={typeof window === "undefined" ? "" : window.location.href}
                  onClick={(event) => copyLink(event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") copyLink(event.currentTarget);
                  }}
                  title="Click to copy"
                  className="min-h-11 w-full min-w-0 max-w-xl cursor-copy bg-surface px-3 text-forest ring-2 ring-fern ring-inset"
                />
                <p role="status" className="min-w-16 font-semibold text-pine">
                  {copied ? "Copied" : ""}
                </p>
              </div>
            )}

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
                  <PartyAvatar colour={memberColours.get(member.id)} hatId={member.hatId} />
                  {memberAction?.id === member.id ? (
                    <>
                      <span role="status">
                        {memberAction.kind === "remove"
                          ? `Remove ${member.displayName}?`
                          : `Make ${member.displayName} the host?`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          memberAction.kind === "remove" ? removeMember(member.id) : makeHost(member.id)
                        }
                        disabled={busy}
                        className={`${chipButton} ${memberAction.kind === "remove" ? "text-danger" : ""}`}
                      >
                        {busy ? "Working" : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMemberAction(null)}
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
                      {/* Only the host sees these, and never on their own name. */}
                      {state.party.isHost && !member.isYou && (
                        <>
                          <button
                            type="button"
                            onClick={() => setMemberAction({ id: member.id, kind: "host" })}
                            className={chipButton}
                          >
                            Make host
                          </button>
                          <button
                            type="button"
                            onClick={() => setMemberAction({ id: member.id, kind: "remove" })}
                            className={`${chipButton} text-danger`}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            </PartyBackdrop>

            {actionError && (
              <div className="mt-6">
                <Notice tone="error">{actionError}</Notice>
              </div>
            )}

            <PartyGames
              party={state.party}
              path={path}
              colours={memberColours}
              onChanged={(changes) =>
                setState((current) =>
                  current.status === "ready"
                    ? { status: "ready", party: { ...current.party, ...changes } }
                    : current,
                )
              }
            />

            <PartyChat path={path} />
          </div>
        )}
      </div>
    </div>
  );
}
