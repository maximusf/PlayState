import { z } from "zod";

export const MAX_PARTY_NAME = 40;
export const MAX_DISPLAY_NAME = 24;

// Line breaks, tabs and other control characters, plus the invisible characters that
// reverse text direction. Neither belongs in a name, and the second can disguise one.
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

// Half of a two-part character such as an emoji, left behind when text is cut mid-character.
// The database cannot store one, so it is refused here with a clear message.
const BROKEN_CHARACTER = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A name other players will read. It is stored and shown as plain text, never run as code,
// so quotes and symbols are harmless and allowed.
function nameField(label: string, max: number) {
  return z
    .string({ error: `${label} is required.` })
    .refine(
      (value) => !UNSAFE_NAME_CHARACTERS.test(value) && !BROKEN_CHARACTER.test(value),
      `${label} contains characters that are not allowed.`,
    )
    // Runs of spaces collapse to one, so a name cannot be padded out or made to look empty.
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );
}

const displayName = nameField("Nickname", MAX_DISPLAY_NAME);

export const CreatePartySchema = z.object({
  name: nameField("Party name", MAX_PARTY_NAME),
  displayName,
});

export const JoinPartySchema = z.object({ displayName });

export const RenamePartySchema = z.object({ name: nameField("Party name", MAX_PARTY_NAME) });

export const PartyMemberParamSchema = z.object({
  memberId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "That party member is not valid."),
});

export const PartyCodeParamSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,32}$/, "That party link is not valid."),
});
