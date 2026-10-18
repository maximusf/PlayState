import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";

// Only the latest messages are kept, so a busy party cannot grow without limit.
export const MAX_KEPT_MESSAGES = 100;

export type ChatMessage = {
  id: string;
  displayName: string;
  body: string;
  createdAt: string;
  isYou: boolean;
};

type MessageRow = { id: string; userId: string; displayName: string; body: string; createdAt: Date };

function toMessage(row: MessageRow, userId: string): ChatMessage {
  // The sender's account ID stays on the server. Everyone else only learns whether it was them.
  return {
    id: row.id,
    displayName: row.displayName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    isYou: row.userId === userId,
  };
}

// Finds the party and the viewer's own membership. Only a current member may read or write,
// so a player the host removed loses the chat along with the rest of the party.
async function findChat(userId: string, code: string) {
  const party = await prisma.party.findUnique({
    where: { code },
    select: {
      id: true,
      expiresAt: true,
      removedUserIds: true,
      members: { where: { userId }, select: { displayName: true } },
    },
  });

  // An expired party that has not been cleaned up yet is treated as gone.
  if (!party || party.expiresAt.getTime() <= Date.now()) {
    throw new AppError(404, "PARTY_NOT_FOUND", "That party could not be found.");
  }

  if (party.removedUserIds.includes(userId)) {
    throw new AppError(403, "PARTY_REMOVED", "The host removed you from this party.");
  }

  if (party.members.length === 0) {
    throw new AppError(403, "PARTY_NOT_JOINED", "Join this party to use its chat.");
  }

  return { partyId: party.id, displayName: party.members[0].displayName };
}

// Without a cursor, the latest messages. With one, only what arrived after that message.
export async function listMessages(userId: string, code: string, after?: string): Promise<ChatMessage[]> {
  const { partyId } = await findChat(userId, code);
  const newestFirst = [{ createdAt: "desc" as const }, { id: "desc" as const }];

  if (after) {
    const seen = await prisma.partyMessage.findFirst({
      where: { id: after, partyId },
      select: { createdAt: true },
    });

    // A message the party has already pruned is simply gone, so start from the latest ones.
    if (seen) {
      const rows = await prisma.partyMessage.findMany({
        where: {
          partyId,
          OR: [
            { createdAt: { gt: seen.createdAt } },
            { createdAt: seen.createdAt, id: { gt: after } },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_KEPT_MESSAGES,
      });

      return rows.map((row) => toMessage(row, userId));
    }
  }

  const rows = await prisma.partyMessage.findMany({
    where: { partyId },
    orderBy: newestFirst,
    take: MAX_KEPT_MESSAGES,
  });

  return rows.reverse().map((row) => toMessage(row, userId));
}

export async function sendMessage(userId: string, code: string, body: string): Promise<ChatMessage> {
  const { partyId, displayName } = await findChat(userId, code);

  const row = await prisma.partyMessage.create({ data: { partyId, userId, displayName, body } });

  // Anything past the newest hundred is dropped, oldest first.
  const stale = await prisma.partyMessage.findMany({
    where: { partyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: MAX_KEPT_MESSAGES,
    select: { id: true },
  });

  if (stale.length > 0) {
    await prisma.partyMessage.deleteMany({ where: { id: { in: stale.map((message) => message.id) } } });
  }

  return toMessage(row, userId);
}
