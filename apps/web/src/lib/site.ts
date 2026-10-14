// Public origin used for absolute URLs in metadata, the sitemap and robots.txt.
// Set NEXT_PUBLIC_SITE_URL in production. Vercel's own URL is the fallback.
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();
export const SITE_NAME = "PlayState";
export const SITE_TAGLINE = "Find the right game for right now.";
export const SITE_DESCRIPTION =
  "Build a library of the games you own, answer three quick questions, and get up to three picks that fit your time and mood.";
export const OG_ALT = "PlayState: Find the right game for right now.";
export const OG_SIZE = { width: 1200, height: 630 };
