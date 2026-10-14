import type { RequestHandler } from "express";
import { AppError } from "../lib/errors";

type Options = { windowMs: number; max: number; message: string };

const stores: Map<string, number[]>[] = [];

export function resetPublicRateLimits(): void {
  for (const store of stores) store.clear();
}

// Like rateLimit, but for routes with no signed-in user: requests are counted per
// client address. The counts live in this server's memory, which suits one API instance.
export function publicRateLimit({ windowMs, max, message }: Options): RequestHandler {
  const recent = new Map<string, number[]>();
  stores.push(recent);

  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const times = (recent.get(key) ?? []).filter((time) => now - time < windowMs);

    if (times.length >= max) {
      recent.set(key, times);
      res.setHeader("Retry-After", String(Math.ceil((times[0] + windowMs - now) / 1000)));
      throw new AppError(429, "RATE_LIMITED", message);
    }

    times.push(now);
    recent.set(key, times);

    if (recent.size > 5000) {
      for (const [address, value] of recent) {
        if (value.every((time) => now - time >= windowMs)) recent.delete(address);
      }
    }

    next();
  };
}
