import { PixelIcon } from "@/components/pixel-icons";
import { AVATAR_HATS, isAvatarHatId } from "@/lib/party-cosmetics";

// A member's avatar: the little person in their colour, with their hat on. It is 32px square
// at scale 1. A hat is 16 pixels wide and is drawn at one screen pixel per hat pixel times the
// scale, which makes it as wide as the head. Every hat shares one offset: its bottom row
// (row 14) rests on the top of the head, so the hat sticks out 12 pixels above the box.
// Use whole scales to keep the pixel art sharp, and leave room above the avatar for the hat.
export function PartyAvatar({
  colour,
  hatId = null,
  scale = 1,
  bob = false,
  className = "",
}: {
  colour?: string;
  hatId?: string | null;
  scale?: number;
  // A slow idle bob of the hat. Off unless asked for, and off for reduced motion.
  bob?: boolean;
  className?: string;
}) {
  const hat = isAvatarHatId(hatId) ? AVATAR_HATS.find((candidate) => candidate.id === hatId) : null;
  const size = 32 * scale;

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 bg-surface ${className}`}
      style={{ width: size, height: size, color: colour }}
    >
      <PixelIcon name="singlePlayer" className="size-full" />
      {hat && (
        // eslint-disable-next-line @next/next/no-img-element -- 16px pixel art, shown crisp and unoptimised
        <img
          src={hat.src}
          alt=""
          draggable={false}
          className={`pointer-events-none absolute max-w-none ${bob ? "party-hat-bob" : ""}`}
          style={{
            width: 16 * scale,
            height: 16 * scale,
            left: 8 * scale,
            top: -12 * scale,
            imageRendering: "pixelated",
          }}
        />
      )}
    </span>
  );
}
