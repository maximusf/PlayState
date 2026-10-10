import { z } from "zod";

export const CatalogSearchSchema = z.object({
  q: z
    .string({ error: "Search query is required." })
    .trim()
    .min(2, "Search query must be at least 2 characters.")
    .max(100, "Search query must be at most 100 characters."),
});

export const IgdbIdParamSchema = z.object({
  igdbId: z.coerce
    .number({ error: "Game ID must be a number." })
    .int("Game ID must be a whole number.")
    .positive("Game ID must be positive."),
});
