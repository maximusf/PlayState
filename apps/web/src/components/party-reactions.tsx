"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, useApi } from "@/lib/api";
import { REACTION_EMOJIS, isReactionEmojiId, type ReactionEmojiId } from "@/lib/party-cosmetics";

type Reaction = { id: string; emoji: string; displayName: string; createdAt: string };
type Feed = { reactions: Reaction[]; cursor: string; serverNow: string };
type Floater = { key: string; emoji: ReactionEmojiId; name: string; left: number; drift: number };

const POLL_MS = 1500;
// The server allows 10 reactions per 10 seconds. The bar keeps to the same limit on its own.
const SEND_LIMIT = 10;
const SEND_WINDOW_MS = 10_000;
const MAX_FLOATING = 30;
const FLOAT_MS = 3200;
const SEEN_LIMIT = 300;

const EMOJI_SRC = new Map<string, string>(REACTION_EMOJIS.map((emoji) => [emoji.id, emoji.src]));

// How long until another reaction fits in the send window, or 0 when one does. Records the send.
function sendWait(times: number[]): number {
  const now = Date.now();
  while (times.length > 0 && now - times[0] >= SEND_WINDOW_MS) times.shift();
  if (times.length >= SEND_LIMIT) return SEND_WINDOW_MS - (now - times[0]);
  times.push(now);
  return 0;
}

const pixelated = { imageRendering: "pixelated" } as const;

// An emoji bar any party member can use, and a layer where everyone's reactions drift up the
// screen. Reactions are polled, shown once each, and never replayed from before the page opened.
export function PartyReactions({ code }: { code: string }) {
  const api = useApi();
  const path = `/api/parties/${encodeURIComponent(code)}/reactions`;

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [badge, setBadge] = useState<{ emoji: ReactionEmojiId; count: number } | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const [notice, setNotice] = useState("");

  const seen = useRef(new Set<string>());
  const cursor = useRef<string | undefined>(undefined);
  const sentAt = useRef<number[]>([]);
  const counter = useRef(0);
  const reducedMotion = useRef(false);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const markSeen = useCallback((id: string) => {
    seen.current.add(id);
    if (seen.current.size > SEEN_LIMIT) {
      const oldest = seen.current.values().next().value;
      if (oldest !== undefined) seen.current.delete(oldest);
    }
  }, []);

  const show = useCallback((reaction: { emoji: string; displayName: string }) => {
    if (!isReactionEmojiId(reaction.emoji)) return;
    const emoji = reaction.emoji;

    if (reducedMotion.current) {
      // No movement: a small badge counts the reactions that arrive close together.
      setBadge((current) => ({ emoji, count: current ? current.count + 1 : 1 }));
      clearTimeout(badgeTimer.current);
      badgeTimer.current = setTimeout(() => setBadge(null), 1800);
      return;
    }

    counter.current += 1;
    const key = `f${counter.current}`;
    const floater: Floater = {
      key,
      emoji,
      name: reaction.displayName,
      left: 6 + Math.random() * 88,
      drift: Math.round((Math.random() - 0.5) * 48),
    };
    setFloaters((current) => [...current, floater].slice(-MAX_FLOATING));
    setTimeout(() => setFloaters((current) => current.filter((item) => item.key !== key)), FLOAT_MS);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = query.matches;
    const onChange = () => (reducedMotion.current = query.matches);
    query.addEventListener("change", onChange);

    let cancelled = false;
    let polling = false;
    // The first poll, and the first after the tab returns, only catches up. It shows nothing.
    let catchUp = true;

    async function poll() {
      if (document.hidden || polling) return;
      polling = true;

      try {
        const feed = await api<Feed>(
          cursor.current ? `${path}?after=${encodeURIComponent(cursor.current)}` : path,
        );
        if (cancelled) return;

        cursor.current = feed.cursor;
        for (const reaction of feed.reactions) {
          if (seen.current.has(reaction.id)) continue;
          markSeen(reaction.id);
          if (!catchUp) show(reaction);
        }
        catchUp = false;
      } catch {
        // A missed poll costs nothing. The next one picks up from the same cursor.
      } finally {
        polling = false;
      }
    }

    function onVisibility() {
      if (document.hidden) return;
      catchUp = true;
      void poll();
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(badgeTimer.current);
      clearTimeout(cooldownTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      query.removeEventListener("change", onChange);
    };
  }, [api, path, markSeen, show]);

  function startCooldown(ms: number) {
    setCooldown(true);
    setNotice("Slow down a little.");
    clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => {
      setCooldown(false);
      setNotice("");
    }, ms);
  }

  async function send(emoji: ReactionEmojiId) {
    const wait = sendWait(sentAt.current);

    if (cooldown || wait > 0) {
      startCooldown(wait > 0 ? wait : 2000);
      return;
    }

    try {
      const sent = await api<{ id: string }>(path, { method: "POST", body: { emoji } });
      // Poll replies for this one are ignored, so the sender does not see it twice.
      markSeen(sent.id);
      show({ emoji, displayName: "You" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) startCooldown(3000);
      else setNotice("Could not send that. Try again.");
    }
  }

  return (
    <>
      {/* The floating layer never takes clicks, so the page underneath stays usable. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
        <style>{`
          @keyframes party-float {
            0% { transform: translate(0, 0); opacity: 0; }
            10% { opacity: 1; }
            75% { opacity: 1; }
            100% { transform: translate(var(--drift), -70vh); opacity: 0; }
          }
        `}</style>
        {floaters.map((floater) => (
          <span
            key={floater.key}
            className="absolute bottom-20 flex flex-col items-center"
            style={
              {
                left: `${floater.left}%`,
                "--drift": `${floater.drift}px`,
                animation: `party-float ${FLOAT_MS}ms linear forwards`,
              } as React.CSSProperties
            }
          >
            <Image
              src={EMOJI_SRC.get(floater.emoji) ?? ""}
              alt=""
              width={16}
              height={16}
              unoptimized
              className="size-12"
              style={pixelated}
            />
            <span className="mt-1 max-w-24 truncate bg-surface px-1 text-sm text-forest">
              {floater.name}
            </span>
          </span>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-3 z-40 flex flex-col items-center gap-2 px-4">
        {badge && (
          <p
            role="status"
            className="flex items-center gap-2 bg-mint px-2 py-1 font-pixel text-lg text-forest shadow-[-4px_0_0_0_var(--color-forest),4px_0_0_0_var(--color-forest),0_-4px_0_0_var(--color-forest),0_4px_0_0_var(--color-forest)]"
          >
            <Image
              src={EMOJI_SRC.get(badge.emoji) ?? ""}
              alt=""
              width={16}
              height={16}
              unoptimized
              className="size-6"
              style={pixelated}
            />
            x{badge.count}
          </p>
        )}
        {notice && (
          <p role="status" className="bg-surface px-2 py-1 text-sm text-danger">
            {notice}
          </p>
        )}
        <div
          role="group"
          aria-label="Send a reaction"
          className="flex max-w-full gap-1 overflow-x-auto bg-surface p-1 shadow-[-4px_0_0_0_var(--color-forest),4px_0_0_0_var(--color-forest),0_-4px_0_0_var(--color-forest),0_4px_0_0_var(--color-forest)]"
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji.id}
              type="button"
              aria-label={emoji.label}
              title={emoji.label}
              disabled={cooldown}
              onClick={() => send(emoji.id)}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center hover:bg-mint focus-visible:bg-mint disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Image
                src={emoji.src}
                alt=""
                width={16}
                height={16}
                unoptimized
                className="size-8"
                style={pixelated}
              />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
