import { z } from "zod";

// Keep in step with REACTION_EMOJIS in apps/web/src/lib/party-cosmetics.ts. The API cannot
// import from the web app, so a test fails if the two lists drift apart.
export const REACTION_EMOJI_IDS = [
  "thumbs-up",
  "heart",
  "laugh",
  "fire",
  "gg",
  "sleepy",
  "shocked",
  "party-popper",
  "skull",
  "clap",
] as const;

export const SendReactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJI_IDS, { error: "Choose one of the reaction emojis." }),
});

export const ReactionsQuerySchema = z.object({
  // The cursor from the last poll, an ISO date.
  after: z.iso.datetime({ error: "after must be an ISO date." }).optional(),
});
