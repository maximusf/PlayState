// The ways a party's dice roll can be shown. These ids are stored in the database, so they must
// match the web app's list in apps/web/src/lib/party-roll-styles.ts. A test fails if they drift.
export const ROLL_STYLE_IDS = [
  "classic",
  "cover-die",
  "carousel",
  "triple-slot",
  "card-shuffle",
] as const;

export type RollStyleId = (typeof ROLL_STYLE_IDS)[number];
