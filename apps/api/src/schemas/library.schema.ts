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
  // Optional, so older clients that send only igdbId keep working.
  familyShared: z.boolean({ error: "familyShared must be true or false." }).optional(),
});

export const SteamProfileSchema = z.object({
  profile: z
    .string({ error: "Steam profile is required." })
    .trim()
    .min(2, "Steam profile is required.")
    .max(200, "Steam profile must be at most 200 characters."),
});

// Larger than any real Steam library, small enough to keep one request bounded.
const MAX_IMPORT = 5000;

export const ImportGamesSchema = z.object({
  igdbIds: z
    .array(
      z
        .number({ error: "igdbIds must be numbers." })
        .int("igdbIds must be whole numbers.")
        .positive("igdbIds must be positive."),
      { error: "igdbIds must be a list of numbers." },
    )
    .min(1, "Choose at least one game to import.")
    .max(MAX_IMPORT, `At most ${MAX_IMPORT} games can be imported at once.`),
});

// One selection in the library. Far below the import limit, as every ID is a row to delete.
export const MAX_BULK_DELETE = 200;

export const DeleteLibraryGamesSchema = z.object({
  ids: z
    .array(
      z
        .string({ error: "ids must be library item IDs." })
        .min(1, "Library item ID is required.")
        .max(64, "That library item ID is not valid."),
      { error: "ids must be a list of library item IDs." },
    )
    .min(1, "Choose at least one game to delete.")
    .max(MAX_BULK_DELETE, `At most ${MAX_BULK_DELETE} games can be deleted at once.`),
});

export const LibraryItemParamSchema = z.object({
  id: z
    .string()
    .min(1, "Library item ID is required.")
    .max(64, "That library item ID is not valid."),
});
