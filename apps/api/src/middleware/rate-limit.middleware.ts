import type { RequestHandler } from "express";
import { AppError } from "../lib/errors";
import { getUserId } from "./auth.middleware";

type Options = { windowMs: number; max: number; message: string };

// Every limiter's memory, so tests can start from a clean slate.
const stores: Map<string, number[]>[] = [];

export function resetRateLimits(): void {
  for (const store of stores) store.clear();
}

// Allows each signed-in user `max` requests per window. Must run after requireUser.
// The counts live in this server's memory, which suits a single API instance.
export function rateLimit({ windowMs, max, message }: Options): RequestHandler {
  const recent = new Map<string, number[]>();
  stores.push(recent);

  return (_req, res, next) => {
    const userId = getUserId(res);
    const now = Date.now();
    const times = (recent.get(userId) ?? []).filter((time) => now - time < windowMs);

    if (times.length >= max) {
      recent.set(userId, times);
      // When the oldest request in the window ages out, there is room again.
      res.setHeader("Retry-After", String(Math.ceil((times[0] + windowMs - now) / 1000)));
      throw new AppError(429, "RATE_LIMITED", message);
    }

    times.push(now);
    recent.set(userId, times);

    // Forget users whose window has emptied, so the map cannot grow without limit.
    if (recent.size > 5000) {
      for (const [key, value] of recent) {
        if (value.every((time) => now - time >= windowMs)) recent.delete(key);
      }
    }

    next();
  };
}
