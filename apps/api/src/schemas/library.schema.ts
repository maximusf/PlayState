import { z } from "zod";

export const SESSION_LENGTHS = ["SHORT", "MEDIUM", "LONG"] as const;

// null clears the tag.
export const SessionLengthSchema = z.object({
  sessionLength: z
    .enum(SESSION_LENGTHS, { error: "sessionLength must be SHORT, MEDIUM, LONG, or null." })
    .nullable(),
});

export const AddLibraryGameSchema = z.object({
  igdbId: z
    .number({ error: "igdbId must be a number." })
    .int("igdbId must be a whole number.")
    .positive("igdbId must be positive."),
});

export const LibraryItemParamSchema = z.object({
  id: z.string().min(1, "Library item ID is required."),
});
