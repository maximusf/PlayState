"use client";

import { useEffect, useId, useRef, useState } from "react";
import { errorMessage, useApi, type PartyDetail } from "@/lib/api";
import { PartyAvatar } from "@/components/party-avatar";
import { Notice } from "@/components/ui";
import { AVATAR_HATS, PARTY_BACKDROPS, isPartyBackdropId } from "@/lib/party-cosmetics";

// A picture behind the top of the party page. A pale scrim sits over it, so the dark text
// stays readable: at 75% paper the weakest text colour (pine) still has a contrast ratio of
// about 5 to 1 against the brightest pixel of any backdrop. The art is scaled to cover the
// box and never tiled, because the space and beach pictures do not repeat cleanly.
export function PartyBackdrop({
  id,
  children,
}: {
  id: string | null;
  children: React.ReactNode;
}) {
  const backdrop = isPartyBackdropId(id) ? PARTY_BACKDROPS.find((item) => item.id === id) : null;
  if (!backdrop) return <>{children}</>;

  return (
    <div className="relative isolate -mx-4 mb-6 px-4 py-5 sm:-mx-6 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: `url(${backdrop.src})`, imageRendering: "pixelated" }}
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-paper/75" />
      {children}
    </div>
  );
}

const optionBase =
  "flex cursor-pointer items-center justify-center bg-surface text-forest hover:bg-mint disabled:opacity-60";
const optionOn = "bg-mint ring-4 ring-forest ring-inset";
const optionOff = "ring-2 ring-fern ring-inset";

// A "Customise" button with a panel under it. Everyone picks their own hat. The host also
// picks the party's backdrop. Each choice is saved at once and shown to the party on its
// next check.
export function PartyCustomise({
  party,
  path,
  colour,
  onChanged,
}: {
  party: PartyDetail;
  path: string;
  // The viewer's avatar colour, so the preview matches the name tag.
  colour: string | undefined;
  onChanged: (update: (party: PartyDetail) => PartyDetail) => void;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const me = party.members.find((member) => member.isYou);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Opening moves focus to the panel's first choice, so the keyboard can carry on from there.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  async function chooseHat(hatId: string | null) {
    setBusy(true);
    setError(null);

    try {
      const saved = await api<{ hatId: string | null; version: string }>(`${path}/me`, {
        method: "PATCH",
        body: { hatId },
      });
      onChanged((current) => ({
        ...current,
        members: current.members.map((member) =>
          member.isYou ? { ...member, hatId: saved.hatId } : member,
        ),
        version: saved.version,
      }));
    } catch (failure) {
      setError(`Your hat was not changed. ${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackdrop(backdropId: string | null) {
    setBusy(true);
    setError(null);

    try {
      const saved = await api<{ backdropId: string | null; version: string }>(`${path}/backdrop`, {
        method: "PATCH",
        body: { backdropId },
      });
      onChanged((current) => ({ ...current, backdropId: saved.backdropId, version: saved.version }));
    } catch (failure) {
      setError(`The backdrop was not changed. ${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="btn btn-secondary"
      >
        Customise
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Customise"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          className="fixed inset-x-4 top-28 z-30 max-h-[75vh] space-y-5 overflow-y-auto bg-surface p-4 pixel-frame sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-3 sm:w-96"
        >
          <section aria-labelledby={`${panelId}-hat`}>
            <div className="flex items-end justify-between gap-4">
              <h2 id={`${panelId}-hat`} className="pixel-label text-pine">
                Your hat
              </h2>
              {/* The preview sits on the same light tile as the name tag, hat and all. */}
              <div className="pt-10 pr-2">
                <PartyAvatar colour={colour} hatId={me?.hatId ?? null} scale={2} bob />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => chooseHat(null)}
                disabled={busy}
                aria-pressed={!me?.hatId}
                className={`${optionBase} min-h-14 text-sm font-semibold ${!me?.hatId ? optionOn : optionOff}`}
              >
                No hat
              </button>
              {AVATAR_HATS.map((hat) => (
                <button
                  key={hat.id}
                  type="button"
                  onClick={() => chooseHat(hat.id)}
                  disabled={busy}
                  aria-pressed={me?.hatId === hat.id}
                  title={hat.label}
                  className={`${optionBase} min-h-14 ${me?.hatId === hat.id ? optionOn : optionOff}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 16px pixel art */}
                  <img
                    src={hat.src}
                    alt=""
                    width={32}
                    height={32}
                    draggable={false}
                    style={{ imageRendering: "pixelated" }}
                  />
                  <span className="sr-only">{hat.label}</span>
                </button>
              ))}
            </div>
          </section>

          {party.isHost && (
            <section aria-labelledby={`${panelId}-backdrop`}>
              <h2 id={`${panelId}-backdrop`} className="pixel-label text-pine">
                Party backdrop
              </h2>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={() => chooseBackdrop(null)}
                  disabled={busy}
                  aria-pressed={party.backdropId === null}
                  className={`${optionBase} min-h-11 justify-start px-3 font-semibold ${
                    party.backdropId === null ? optionOn : optionOff
                  }`}
                >
                  No backdrop
                </button>
                {PARTY_BACKDROPS.map((backdrop) => (
                  <button
                    key={backdrop.id}
                    type="button"
                    onClick={() => chooseBackdrop(backdrop.id)}
                    disabled={busy}
                    aria-pressed={party.backdropId === backdrop.id}
                    className={`${optionBase} min-h-11 justify-start gap-3 px-3 font-semibold ${
                      party.backdropId === backdrop.id ? optionOn : optionOff
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-6 w-24 shrink-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${backdrop.src})`, imageRendering: "pixelated" }}
                    />
                    {backdrop.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </div>
  );
}
