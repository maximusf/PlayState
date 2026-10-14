import { z } from "zod";

export const DiscoverQuerySchema = z.object({
  // Mature games are shown only when the browser says so outright. Anything else means hidden.
  mature: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export type DiscoverQuery = z.infer<typeof DiscoverQuerySchema>;
