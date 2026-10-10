import { z } from "zod";

export const AVAILABLE_TIMES = [
  "UNDER_30",
  "THIRTY_TO_SIXTY",
  "ONE_TO_TWO_HOURS",
  "TWO_PLUS_HOURS",
  "ANY",
] as const;

export const GAME_PREFERENCES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Shooter",
  "Puzzle",
  "Platformer",
  "Racing",
  "Sports",
  "Sandbox",
] as const;

export const GAME_MODES = ["SINGLE_PLAYER", "MULTIPLAYER", "EITHER"] as const;

export const RecommendationSchema = z.object({
  availableTime: z.enum(AVAILABLE_TIMES, {
    error: "availableTime is not a supported value.",
  }),
  // An empty list means "anything".
  genres: z
    .array(z.enum(GAME_PREFERENCES, { error: "genres contains an unsupported value." }), {
      error: "genres must be a list.",
    })
    .max(GAME_PREFERENCES.length, "Too many genres."),
  gameMode: z.enum(GAME_MODES, { error: "gameMode is not a supported value." }),
});

export type RecommendationInput = z.infer<typeof RecommendationSchema>;
