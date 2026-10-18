// Party cosmetics: reaction emojis (16x16), avatar hats (16x16) and party
// backdrops (480x120). The ids are stored in the database, so never rename one.
// Add new entries at the end. Art lives in public/party and sources in design/.

export type CosmeticItem<Id extends string> = {
  id: Id;
  label: string;
  src: string;
};

export const REACTION_EMOJIS = [
  { id: "thumbs-up", label: "Thumbs up", src: "/party/emoji/thumbs-up.png" },
  { id: "heart", label: "Heart", src: "/party/emoji/heart.png" },
  { id: "laugh", label: "Laugh", src: "/party/emoji/laugh.png" },
  { id: "fire", label: "Fire", src: "/party/emoji/fire.png" },
  { id: "gg", label: "GG", src: "/party/emoji/gg.png" },
  { id: "sleepy", label: "Sleepy", src: "/party/emoji/sleepy.png" },
  { id: "shocked", label: "Shocked", src: "/party/emoji/shocked.png" },
  { id: "party-popper", label: "Party popper", src: "/party/emoji/party-popper.png" },
  { id: "skull", label: "Skull", src: "/party/emoji/skull.png" },
] as const satisfies readonly CosmeticItem<string>[];

export const AVATAR_HATS = [
  { id: "party-hat", label: "Party hat", src: "/party/hats/party-hat.png" },
  { id: "crown", label: "Crown", src: "/party/hats/crown.png" },
  { id: "cowboy-hat", label: "Cowboy hat", src: "/party/hats/cowboy-hat.png" },
  { id: "top-hat", label: "Top hat", src: "/party/hats/top-hat.png" },
  { id: "wizard-hat", label: "Wizard hat", src: "/party/hats/wizard-hat.png" },
  { id: "beanie", label: "Beanie", src: "/party/hats/beanie.png" },
  { id: "headband", label: "Headband", src: "/party/hats/headband.png" },
  { id: "halo", label: "Halo", src: "/party/hats/halo.png" },
] as const satisfies readonly CosmeticItem<string>[];

export const PARTY_BACKDROPS = [
  { id: "arcade", label: "Arcade", src: "/party/backdrops/arcade.png" },
  { id: "space", label: "Space", src: "/party/backdrops/space.png" },
  { id: "forest-night", label: "Forest night", src: "/party/backdrops/forest-night.png" },
  { id: "beach-sunset", label: "Beach sunset", src: "/party/backdrops/beach-sunset.png" },
  { id: "city-night", label: "City night", src: "/party/backdrops/city-night.png" },
] as const satisfies readonly CosmeticItem<string>[];

export type ReactionEmojiId = (typeof REACTION_EMOJIS)[number]["id"];
export type AvatarHatId = (typeof AVATAR_HATS)[number]["id"];
export type PartyBackdropId = (typeof PARTY_BACKDROPS)[number]["id"];

export const REACTION_EMOJI_IDS: readonly ReactionEmojiId[] = REACTION_EMOJIS.map((e) => e.id);
export const AVATAR_HAT_IDS: readonly AvatarHatId[] = AVATAR_HATS.map((h) => h.id);
export const PARTY_BACKDROP_IDS: readonly PartyBackdropId[] = PARTY_BACKDROPS.map((b) => b.id);

export function isReactionEmojiId(value: unknown): value is ReactionEmojiId {
  return typeof value === "string" && (REACTION_EMOJI_IDS as readonly string[]).includes(value);
}

export function isAvatarHatId(value: unknown): value is AvatarHatId {
  return typeof value === "string" && (AVATAR_HAT_IDS as readonly string[]).includes(value);
}

export function isPartyBackdropId(value: unknown): value is PartyBackdropId {
  return typeof value === "string" && (PARTY_BACKDROP_IDS as readonly string[]).includes(value);
}
