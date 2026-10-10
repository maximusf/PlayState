import type { RecommendationInput } from "../schemas/recommendation.schema";

export type Preference = RecommendationInput["genres"][number];

// Maps each picker option to IGDB genre and theme names.
// "primary" names are a direct match (+2), "related" names are a looser match (+1).
export const PREFERENCE_TAGS: Record<Preference, { primary: string[]; related: string[] }> = {
  Action: {
    primary: ["Action", "Hack and slash/Beat 'em up", "Fighting"],
    related: ["Shooter", "Platform", "Arcade"],
  },
  Adventure: {
    primary: ["Adventure", "Point-and-click"],
    related: ["Open world", "Visual Novel", "Mystery"],
  },
  RPG: {
    primary: ["Role-playing (RPG)"],
    related: ["Fantasy", "Open world"],
  },
  Strategy: {
    primary: [
      "Strategy",
      "Real Time Strategy (RTS)",
      "Turn-based strategy (TBS)",
      "Tactical",
      "MOBA",
    ],
    related: ["4X (explore, expand, exploit, and exterminate)", "Card & Board Game", "Warfare"],
  },
  Simulation: {
    primary: ["Simulator"],
    related: ["Business", "Sandbox"],
  },
  Shooter: {
    primary: ["Shooter"],
    related: ["Warfare"],
  },
  Puzzle: {
    primary: ["Puzzle"],
    related: ["Point-and-click", "Card & Board Game", "Quiz/Trivia"],
  },
  Platformer: {
    primary: ["Platform"],
    related: ["Arcade"],
  },
  Racing: {
    primary: ["Racing"],
    related: [],
  },
  Sports: {
    primary: ["Sport"],
    related: [],
  },
  Sandbox: {
    primary: ["Sandbox"],
    related: ["Open world", "Survival", "Simulator"],
  },
};

export const MULTIPLAYER_MODES = [
  "Multiplayer",
  "Co-operative",
  "Split screen",
  "Massively Multiplayer Online (MMO)",
  "Battle Royale",
];

export function hasAny(tags: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => tags.includes(candidate));
}

// Lists the picker choices that can surface a game, worded as the picker words them.
export function matchingPickerChoices(game: {
  genres: string[];
  themes: string[];
  gameModes: string[];
}): string[] {
  const tags = [...game.genres, ...game.themes];
  const choices: string[] = (Object.keys(PREFERENCE_TAGS) as Preference[]).filter(
    (preference) =>
      hasAny(tags, PREFERENCE_TAGS[preference].primary) ||
      hasAny(tags, PREFERENCE_TAGS[preference].related),
  );

  if (game.gameModes.includes("Single player")) choices.push("Single-player");
  if (hasAny(game.gameModes, MULTIPLAYER_MODES)) choices.push("Multiplayer");

  return choices;
}
