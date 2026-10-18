// The ways a party's dice roll can be shown. The host picks one for the whole party. The ids are
// stored in the database, so never rename one, and add new entries at the end. The API keeps the
// same list in apps/api/src/lib/party-roll-styles.ts, and a test fails if the two drift.
//
// `ms` is how long the animation runs once it starts. Every member's browser starts it at the same
// moment, so the length has to be the same for everyone.

export const ROLL_STYLES = [
  {
    id: "classic",
    label: "Classic die",
    blurb: "A die is thrown, bounces and lands.",
    ms: 2600,
  },
  {
    id: "cover-die",
    label: "Cover die",
    blurb: "A die with a game cover on every face, thrown into a tray.",
    ms: 3800,
  },
  {
    id: "carousel",
    label: "Cover carousel",
    blurb: "Covers sweep past in a 3D row and settle on the pick.",
    ms: 3600,
  },
  {
    id: "triple-slot",
    label: "Triple slot",
    blurb: "Three reels stop one by one and all match on the pick.",
    ms: 3600,
  },
  {
    id: "card-shuffle",
    label: "Card shuffle",
    blurb: "Covers swirl round, stack up, and the pick pops out of the pile.",
    ms: 3600,
  },
] as const;

export type RollStyleId = (typeof ROLL_STYLES)[number]["id"];

export const DEFAULT_ROLL_STYLE: RollStyleId = "classic";

export function isRollStyleId(value: unknown): value is RollStyleId {
  return typeof value === "string" && ROLL_STYLES.some((style) => style.id === value);
}

// How long a roll in this style runs. Unknown ids get the classic die's length.
export function rollStyleMs(value: unknown): number {
  return ROLL_STYLES.find((style) => style.id === value)?.ms ?? ROLL_STYLES[0].ms;
}
