import { prisma } from "../lib/prisma";

// Everything a link preview may show. Nothing here identifies an account.
export type PartyPreview =
  | { active: true; name: string; memberCount: number; hostName: string | null }
  | { active: false; name: null; memberCount: 0; hostName: null };

// One answer for a code that does not exist, one that has expired, and one that is
// malformed, so the endpoint cannot be used to tell them apart or to probe for codes.
export const INACTIVE_PREVIEW: PartyPreview = {
  active: false,
  name: null,
  memberCount: 0,
  hostName: null,
};

export async function getPartyPreview(code: string): Promise<PartyPreview> {
  const party = await prisma.party.findUnique({
    where: { code },
    // Only these fields are read, so nothing else can reach the response by mistake.
    select: {
      name: true,
      hostId: true,
      expiresAt: true,
      members: { select: { userId: true, displayName: true } },
    },
  });

  if (!party || party.expiresAt.getTime() <= Date.now()) {
    return INACTIVE_PREVIEW;
  }

  const host = party.members.find((member) => member.userId === party.hostId);

  return {
    active: true,
    name: party.name,
    memberCount: party.members.length,
    hostName: host?.displayName ?? null,
  };
}
