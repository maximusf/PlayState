// The hats and backdrops a party can use. These ids are stored in the database, so they must
// match the web app's list in apps/web/src/lib/party-cosmetics.ts. A test fails if they drift.
export const AVATAR_HAT_IDS = [
  "party-hat",
  "crown",
  "cowboy-hat",
  "top-hat",
  "wizard-hat",
  "beanie",
  "headband",
  "halo",
] as const;

export const PARTY_BACKDROP_IDS = [
  "arcade",
  "space",
  "forest-night",
  "beach-sunset",
  "city-night",
] as const;
