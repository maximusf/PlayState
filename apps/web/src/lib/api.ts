"use client";

import { useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

// Shapes returned by the PlayState API.
export type GameSearchResult = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
  releaseDate: string | null;
  rating: number | null;
  ratingCount: number;
};

export type SessionLength = "SHORT" | "MEDIUM" | "LONG";

export type LibraryEntry = {
  id: string;
  addedAt: string;
  sessionLength: SessionLength | null;
  familyShared: boolean;
  game: {
    igdbId: number;
    title: string;
    coverUrl: string | null;
    genres: string[];
    themes: string[];
    gameModes: string[];
    releaseDate: string | null;
    timeToBeatHours: number | null;
  };
};

export type LibraryEntryDetail = LibraryEntry & {
  summary: string | null;
  platforms: string[];
  pickerChoices: string[];
};

export type SteamImportGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
  playtimeMinutes: number;
  lastPlayedAt: string | null;
  free: boolean;
  inLibrary: boolean;
};

export type SteamImportPreview = {
  games: SteamImportGame[];
  unmatched: string[];
};

export type ImportResult = { added: number; skipped: number };

export type PartySummary = {
  code: string;
  name: string;
  memberCount: number;
  expiresAt: string;
  // Whether the host has already used the one extension.
  // Whether the viewer started this party, and so can end it.
  isHost: boolean;
};

export type PartyInvite = PartySummary & {
  joined: boolean;
  // True when the host removed this player, who can then no longer join.
  removed: boolean;
};

type PartyGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  gameModes: string[];
  // The most players the game supports. Null when IGDB has no figure.
  maxPlayers: number | null;
};

export type PartyDetail = PartySummary & {
  // id names a member within this party. It is not an account ID.
  members: { id: string; displayName: string; hatId: string | null; isYou: boolean; isHost: boolean }[];
  // libraryEntryId points at the viewer's own copy of the game.
  shared: (PartyGame & { libraryEntryId: string | null })[];
  // missing is the display name of the one member who does not own the game.
  almost: (PartyGame & { missing: string; missingIsYou: boolean })[];
  // The viewer's own multiplayer games that are in neither list.
  others: PartyGame[];
  // The host's latest dice roll, the same for every member.
  rolledIgdbId: number | null;
  rolledAt: string | null;
  // The server clock when this was sent, so every browser can start the dice together.
  serverNow: string;
  // The host's setting: games too small for the group still count as playable.
  ignoreLimits: boolean;
  // Games members put forward for the next roll. memberId matches an entry in members.
  nominations: { igdbId: number; memberId: string }[];
  // The host's picture for the top of the party page. Null means none.
  backdropId: string | null;
  // Changes whenever the party does. The page checks it to know when to reload.
  version: string;
};

export type PartyNominations = { nominations: PartyDetail["nominations"]; version: string };

// serverNow is the server clock when the answer was made, so browsers can line their dice up.
export type PartyRoll = { rolledIgdbId: number; rolledAt: string; serverNow: string; version: string };

export type PartySettings = { name: string; ignoreLimits: boolean; version: string };

export type Recommendation = {
  id: string;
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  gameModes: string[];
  reasons: string[];
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_MESSAGE = "PlayState could not reach its server. Check your connection and try again.";

// Returns a fetch helper that attaches the Clerk session token.
// The API identifies the user from that token, so no user ID is ever sent.
export function useApi() {
  const { getToken } = useAuth();

  return useCallback(
    async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const send = (token: string | null) =>
        fetch(`${API_URL}${path}`, {
          method: init.method ?? "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });

      let response: Response;

      try {
        response = await send(await getToken());

        // Right after sign-up the session token can be missing or not yet accepted.
        // Wait briefly, ask Clerk for a fresh token, and try once more.
        if (response.status === 401) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          response = await send(await getToken({ skipCache: true }));
        }
      } catch {
        throw new ApiError(0, "NETWORK_ERROR", NETWORK_MESSAGE);
      }

      if (response.status === 204) return undefined as T;

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? "UNKNOWN_ERROR",
          payload?.error?.message ?? "Something went wrong. Try again.",
        );
      }

      return payload.data as T;
    },
    [getToken],
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}
