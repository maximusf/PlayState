import { z } from "zod";

export const AddLibraryGameSchema = z.object({
  igdbId: z
    .number({ error: "igdbId must be a number." })
    .int("igdbId must be a whole number.")
    .positive("igdbId must be positive."),
});

export const LibraryItemParamSchema = z.object({
  id: z.string().min(1, "Library item ID is required."),
});
