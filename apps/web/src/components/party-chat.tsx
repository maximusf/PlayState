"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, errorMessage, useApi } from "@/lib/api";
import { CountedInput, Notice } from "@/components/ui";

type ChatMessage = {
  id: string;
  displayName: string;
  body: string;
  createdAt: string;
  isYou: boolean;
};

// Matches the API's cap. The server enforces it too, so this only saves a round trip.
const MAX_MESSAGE_LENGTH = 200;
// The API keeps this many per party, so the page never needs to hold more.
const KEPT_MESSAGES = 100;
// How often new messages are fetched, and how often when the tab is in the background.
const POLL_MS = 2000;
const HIDDEN_POLL_MS = 15000;
// Within this many pixels of the bottom counts as "following the chat".
const BOTTOM_SLACK = 24;

function time(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// A small chat for the people in one party. Messages are plain text, kept only until the
// party ends, and cannot be edited or deleted. `path` is the party's API path.
export function PartyChat({ path }: { path: string }) {
  const api = useApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server says this player cannot use the chat, which hides it.
  const [unavailable, setUnavailable] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastIdRef = useRef<string | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Adds messages that are not already shown, and counts the ones from others as unread
  // while the panel is closed.
  const receive = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;

    lastIdRef.current = incoming[incoming.length - 1].id;
    if (!openRef.current) setUnread((count) => count + incoming.filter((m) => !m.isYou).length);

    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      const fresh = incoming.filter((message) => !known.has(message.id));

      return [...current, ...fresh].slice(-KEPT_MESSAGES);
    });
  }, []);

  // Asks for what is new, again and again, a little slower while the tab is hidden.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const query = lastIdRef.current ? `?after=${encodeURIComponent(lastIdRef.current)}` : "";
        const data = await api<{ messages: ChatMessage[] }>(`${path}/messages${query}`);

        if (stopped) return;
        receive(data.messages);
      } catch (caught) {
        // Removed from the party, or the party is gone. There is nothing left to poll.
        if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
          if (!stopped) setUnavailable(true);
          return;
        }
        // Anything else is a hiccup. The next round tries again.
      }

      if (!stopped) timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    }

    void poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, path, receive]);

  // Stays on the newest message, unless the reader has scrolled up to look at older ones.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (open && list && followingRef.current) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  function toggle() {
    if (!open) {
      setUnread(0);
      followingRef.current = true;
    }
    setOpen(!open);
  }

  function onScroll() {
    const list = listRef.current;
    if (list) followingRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= BOTTOM_SLACK;
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();

    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);

    try {
      const sent = await api<ChatMessage>(`${path}/messages`, { method: "POST", body: { body } });

      setDraft("");
      followingRef.current = true;
      receive([sent]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  if (unavailable) return null;

  return (
    <section aria-label="Party chat" className="mt-10 bg-surface pixel-frame">
      <h2 className="m-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="party-chat-panel"
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left"
        >
          <span className="font-pixel text-4xl leading-none text-forest">Chat</span>
          <span className="flex items-center gap-3">
            {unread > 0 && (
              <span className="bg-mint px-2 py-0.5 text-sm font-semibold text-forest tabular-nums ring-2 ring-forest ring-inset">
                {unread > 99 ? "99+" : unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
            <span aria-hidden="true" className="text-forest">
              {open ? "Hide" : "Show"}
            </span>
          </span>
        </button>
      </h2>

      <div id="party-chat-panel" hidden={!open} className="border-t-2 border-dotted border-fern p-4">
        {/* role="log" is read out politely as new lines arrive, without moving focus. */}
        <div
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
          tabIndex={0}
          className="h-64 overflow-y-auto bg-paper p-3 ring-2 ring-fern ring-inset"
        >
          {messages.length === 0 ? (
            <p className="text-muted">No messages yet. Say hi. Chat clears when the party ends.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((message) => (
                <li key={message.id} className="break-words">
                  <span className={`font-semibold ${message.isYou ? "text-pine" : "text-forest"}`}>
                    {message.displayName}
                  </span>
                  <span className="ml-2 text-sm text-muted">{time(message.createdAt)}</span>
                  {/* A text node, so anything a player types is shown as typed and never run. */}
                  <p className="text-slate">{message.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <form onSubmit={send} className="mt-3 flex items-start gap-3">
          <label htmlFor="party-chat-message" className="sr-only">
            Message
          </label>
          <div className="min-w-0 flex-1">
            <CountedInput
              id="party-chat-message"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
              autoComplete="off"
              enterKeyHint="send"
              placeholder="Write a message"
              className="min-h-11 w-full min-w-0 bg-surface px-3 text-forest ring-2 ring-fern ring-inset placeholder:text-muted/70"
            />
          </div>
          <button type="submit" disabled={sending || draft.trim() === ""} className="btn btn-primary">
            {sending ? "Sending" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}
