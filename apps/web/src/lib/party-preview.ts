// What a link preview may show about a party. The API sends nothing else, and an
// unknown, expired or malformed code all come back as the same inactive answer.
// Server-side only: it is used by the public invite page and its image.
export type PartyPreview =
  | { active: true; name: string; memberCount: number; hostName: string | null }
  | { active: false };

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const CODE_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

export async function fetchPartyPreview(code: string): Promise<PartyPreview> {
  if (!CODE_PATTERN.test(code)) return { active: false };

  try {
    const res = await fetch(`${API_URL}/api/public/parties/${code}/preview`, {
      // A short cache keeps a busy chat channel from hitting the API on every unfurl,
      // and still shows a new player count within a minute.
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { active: false };

    const { data } = (await res.json()) as {
      data?: { active?: boolean; name?: unknown; memberCount?: unknown; hostName?: unknown };
    };
    if (!data?.active || typeof data.name !== "string") return { active: false };

    return {
      active: true,
      name: data.name,
      memberCount: typeof data.memberCount === "number" ? data.memberCount : 1,
      hostName: typeof data.hostName === "string" ? data.hostName : null,
    };
  } catch {
    return { active: false };
  }
}

// Cuts text to a number of whole characters, so an emoji is never split in half.
export function truncate(text: string, max: number): string {
  const characters = Array.from(text.trim());

  return characters.length <= max
    ? characters.join("")
    : `${characters.slice(0, max - 1).join("")}…`;
}

export function playersLabel(count: number): string {
  return count === 1 ? "1 player is in" : `${count} players are in`;
}
