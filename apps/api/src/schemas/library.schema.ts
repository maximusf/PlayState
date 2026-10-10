import { z } from "zod";
import { AVAILABLE_TIMES } from "./recommendation.schema";

export const SESSION_LENGTHS = ["SHORT", "MEDIUM", "LONG"] as const;

// null clears the tag.
export const SessionLengthSchema = z.object({
  sessionLength: z
    .enum(SESSION_LENGTHS, { error: "sessionLength must be SHORT, MEDIUM, LONG, or null." })
    .nullable(),
});

export const PickSchema = z.object({
  availableTime: z.enum(AVAILABLE_TIMES, { error: "availableTime is not a supported value." }),
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
