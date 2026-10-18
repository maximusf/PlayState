import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";

// Reactions are fleeting, so rows older than this are removed whenever a new one arrives.
export const REACTION_TTL_MS = 60 * 1000;
// The most rows kept per party, so a busy party cannot fill the table.
export const MAX_REACTIONS_PER_PARTY = 60;
// The most a poll returns.
const MAX_RETURNED = 50;

export type PartyReactionItem = {
  id: string;
  emoji: string;
  displayName: string;
  userId: string;
  createdAt: string;
};

export type ReactionFeed = {
  reactions: PartyReactionItem[];
  // Pass this back as `after` on the next poll.
  cursor: string;
  serverNow: string;
};

// Only a current member may react or watch. A removed player is no longer a member, and
// the removed list is checked as well so a stale membership row can never get around it.
async function findMemberParty(userId: string, code: string) {
  const party = await prisma.party.findUnique({
    where: { code },
    include: { members: true },
  });

  if (!party || party.expiresAt.getTime() <= Date.now()) {
    throw new AppError(404, "PARTY_NOT_FOUND", "That party could not be found.");
  }
  if (party.removedUserIds.includes(userId)) {
    throw new AppError(403, "PARTY_REMOVED", "You were removed from this party.");
  }
  if (!party.members.some((member) => member.userId === userId)) {
    throw new AppError(403, "PARTY_NOT_JOINED", "Join this party to react.");
  }

  return party;
}

export async function sendReaction(userId: string, code: string, emoji: string) {
  const party = await findMemberParty(userId, code);
  const now = new Date();

  const reaction = await prisma.partyReaction.create({
    data: { partyId: party.id, userId, emoji, createdAt: now },
  });

  await prune(party.id, now);

  return { id: reaction.id, emoji, createdAt: reaction.createdAt.toISOString() };
}

async function prune(partyId: string, now: Date): Promise<void> {
  await prisma.partyReaction.deleteMany({
    where: { partyId, createdAt: { lt: new Date(now.getTime() - REACTION_TTL_MS) } },
  });

  // Anything past the newest MAX_REACTIONS_PER_PARTY rows goes too.
  const extra = await prisma.partyReaction.findMany({
    where: { partyId },
    orderBy: { createdAt: "desc" },
    skip: MAX_REACTIONS_PER_PARTY,
    select: { id: true },
  });
  if (extra.length > 0) {
    await prisma.partyReaction.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
  }
}

// Reactions since the cursor, oldest first. The comparison includes the cursor itself so
// two reactions in the same millisecond are never missed, and the client skips ids it has seen.
export async function listReactions(
  userId: string,
  code: string,
  after: string | undefined,
): Promise<ReactionFeed> {
  const party = await findMemberParty(userId, code);
  const now = new Date();
  const floor = new Date(now.getTime() - REACTION_TTL_MS);
  const since = after && new Date(after) > floor ? new Date(after) : floor;

  const rows = await prisma.partyReaction.findMany({
    where: { partyId: party.id, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: MAX_RETURNED,
  });

  const names = new Map(party.members.map((member) => [member.userId, member.displayName]));
  const reactions = rows.map((row) => ({
    id: row.id,
    emoji: row.emoji,
    userId: row.userId,
    displayName: names.get(row.userId) ?? "Player",
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    reactions,
    cursor: (rows.length > 0 ? rows[rows.length - 1].createdAt : since).toISOString(),
    serverNow: now.toISOString(),
  };
}
