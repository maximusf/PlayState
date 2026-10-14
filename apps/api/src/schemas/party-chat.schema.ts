import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 200;

// Line breaks, tabs and other control characters, plus the invisible characters that
// reverse text direction. A chat line is one line of plain text.
const UNSAFE_CHARACTERS = /[\p{Cc}‪-‮⁦-⁩]/u;

// Half of a two-part character such as an emoji, left behind when text is cut mid-character.
// The database cannot store one, so it is refused here with a clear message.
const BROKEN_CHARACTER = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const SendMessageSchema = z.object({
  body: z
    .string({ error: "Write a message first." })
    .refine(
      (value) => !UNSAFE_CHARACTERS.test(value) && !BROKEN_CHARACTER.test(value),
      "Messages cannot contain line breaks or special control characters.",
    )
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Write a message first.")
        .max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`),
    ),
});

// `after` is the ID of the newest message the browser already has.
export const ListMessagesQuerySchema = z.object({
  after: z.string().min(1).max(64).optional(),
});
