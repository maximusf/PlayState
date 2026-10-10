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
  pickedFor: string[];
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
  pickerChoices: string[];
};

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
