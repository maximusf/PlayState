import { renderOgCard } from "@/lib/og-card";
import { OG_ALT, OG_SIZE } from "@/lib/site";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgCard();
}
