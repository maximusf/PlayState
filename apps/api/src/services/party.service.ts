import { randomBytes } from "node:crypto";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getMaxPlayers } from "./igdb.service";
import { hasAny, MULTIPLAYER_MODES } from "./preferences";

// Keeps one party small enough to compare quickly, and one account from creating endless parties.
const MAX_MEMBERS = 12;
const MAX_PARTIES_PER_USER = 20;
// How many parties one player can be hosting at once.
const MAX_HOSTED_PARTIES = 3;
// A party is for one evening of deciding what to play. After a day it is gone.
const PARTY_LIFETIME_MS = 24 * 60 * 60 * 1000;

type PartyGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  genres: string[];
  gameModes: string[];
  // The most players IGDB lists for the game. Null when IGDB has no figure.
  maxPlayers: number | null;
};

export type PartySummary = {
  code: string;
  name: string;
  memberCount: number;
  expiresAt: string;
  // Whether the viewer started this party, and so can end it.
  isHost: boolean;
};

export type PartyInvite = PartySummary & { joined: boolean };

export type PartyDetail = PartySummary & {
  members: { displayName: string; isYou: boolean; isHost: boolean }[];
  // Multiplayer games every member owns. libraryEntryId is the viewer's own entry.
  shared: (PartyGame & { libraryEntryId: string | null })[];
  // Multiplayer games all but one member owns, and who is missing each.
  almost: (PartyGame & { missing: string })[];
};

function expiresAt(party: { createdAt: Date }): Date {
  return new Date(party.createdAt.getTime() + PARTY_LIFETIME_MS);
}

// Expired parties are removed whenever someone lists, starts or joins one, so no
// scheduled job is needed. Deleting a party deletes its memberships with it.
async function deleteExpiredParties(): Promise<void> {
  await prisma.party.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - PARTY_LIFETIME_MS) } },
  });
}

function notFound(): AppError {
  return new AppError(404, "PARTY_NOT_FOUND", "That party could not be found.");
}

async function findParty(code: string) {
  const party = await prisma.party.findUnique({
    where: { code },
    include: { members: { orderBy: { joinedAt: "asc" } } },
  });

  // An expired party that has not been cleaned up yet is treated as gone.
  if (!party || expiresAt(party).getTime() <= Date.now()) throw notFound();

  return party;
}

export async function listParties(userId: string): Promise<PartySummary[]> {
  await deleteExpiredParties();

  const parties = await prisma.party.findMany({
    where: { members: { some: { userId } } },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });

  return parties.map((party) => ({
    code: party.code,
    name: party.name,
    memberCount: party._count.members,
    expiresAt: expiresAt(party).toISOString(),
    isHost: party.hostId === userId,
  }));
}

export async function createParty(
  userId: string,
  name: string,
  displayName: string,
): Promise<PartySummary> {
  await deleteExpiredParties();

  if ((await prisma.party.count({ where: { hostId: userId } })) >= MAX_HOSTED_PARTIES) {
    throw new AppError(
      409,
      "PARTY_HOST_LIMIT",
      `You can host ${MAX_HOSTED_PARTIES} parties at a time. End one to start another.`,
    );
  }

  if ((await prisma.partyMember.count({ where: { userId } })) >= MAX_PARTIES_PER_USER) {
    throw new AppError(
      409,
      "PARTY_LIMIT_REACHED",
      `You can be in at most ${MAX_PARTIES_PER_USER} parties. Leave one to start another.`,
    );
  }

  const party = await prisma.party.create({
    data: {
      // 72 random bits. The code is the only thing protecting the invite, so it must not be guessable.
      code: randomBytes(9).toString("base64url"),
      name,
      hostId: userId,
      members: { create: { userId, displayName } },
    },
  });

  return {
    code: party.code,
    name: party.name,
    memberCount: 1,
    expiresAt: expiresAt(party).toISOString(),
    isHost: true,
  };
}

// What someone holding the link sees before joining. No member names and no games.
export async function getInvite(userId: string, code: string): Promise<PartyInvite> {
  const party = await findParty(code);

  return {
    code: party.code,
    name: party.name,
    memberCount: party.members.length,
    expiresAt: expiresAt(party).toISOString(),
    isHost: party.hostId === userId,
    joined: party.members.some((member) => member.userId === userId),
  };
}

export async function joinParty(
  userId: string,
  code: string,
  displayName: string,
): Promise<PartySummary> {
  await deleteExpiredParties();

  const party = await findParty(code);
  const alreadyIn = party.members.some((member) => member.userId === userId);

  if (!alreadyIn && party.members.length >= MAX_MEMBERS) {
    throw new AppError(409, "PARTY_FULL", `This party is full. A party holds ${MAX_MEMBERS} players.`);
  }

  if (!alreadyIn && (await prisma.partyMember.count({ where: { userId } })) >= MAX_PARTIES_PER_USER) {
    throw new AppError(
      409,
      "PARTY_LIMIT_REACHED",
      `You can be in at most ${MAX_PARTIES_PER_USER} parties. Leave one to join another.`,
    );
  }

  // Joining again just updates the name, so opening the link twice is harmless.
  await prisma.partyMember.upsert({
    where: { partyId_userId: { partyId: party.id, userId } },
    create: { partyId: party.id, userId, displayName },
    update: { displayName },
  });

  return {
    code: party.code,
    name: party.name,
    memberCount: party.members.length + (alreadyIn ? 0 : 1),
    expiresAt: expiresAt(party).toISOString(),
    isHost: party.hostId === userId,
  };
}

export async function getParty(userId: string, code: string): Promise<PartyDetail> {
  const party = await findParty(code);

  // Only members may see who is in a party and what they own in common.
  if (!party.members.some((member) => member.userId === userId)) {
    throw new AppError(403, "PARTY_NOT_JOINED", "Join this party to see its games.");
  }

  const memberIds = party.members.map((member) => member.userId);
  const entries = await prisma.userGame.findMany({
    where: { userId: { in: memberIds } },
    include: { game: true },
  });

  // For each game, which members own it.
  const owners = new Map<string, { game: (typeof entries)[number]["game"]; userIds: Set<string> }>();
  const viewerEntries = new Map<string, string>();

  for (const entry of entries) {
    if (entry.userId === userId) viewerEntries.set(entry.gameId, entry.id);
    // A game is only worth suggesting to a group if it can be played together.
    if (!hasAny(entry.game.gameModes, MULTIPLAYER_MODES)) continue;

    const record = owners.get(entry.gameId) ?? { game: entry.game, userIds: new Set<string>() };
    record.userIds.add(entry.userId);
    owners.set(entry.gameId, record);
  }

  const shared: PartyDetail["shared"] = [];
  const almost: PartyDetail["almost"] = [];

  for (const [gameId, { game, userIds }] of owners) {
    const summary = {
      igdbId: game.igdbId,
      title: game.title,
      coverUrl: game.coverUrl,
      genres: game.genres,
      gameModes: game.gameModes,
      maxPlayers: null as number | null,
    };

    if (userIds.size === memberIds.length) {
      shared.push({ ...summary, libraryEntryId: viewerEntries.get(gameId) ?? null });
    } else if (memberIds.length >= 3 && userIds.size === memberIds.length - 1) {
      // With two players, "all but one" would just be each person's own library.
      const missing = party.members.find((member) => !userIds.has(member.userId));
      if (missing) almost.push({ ...summary, missing: missing.displayName });
    }
  }

  // IGDB knows the player limit for most games, not all. A missing figure, or IGDB being
  // down, leaves maxPlayers null, and the game is still listed.
  const listed = [...shared, ...almost];
  const limits = await getMaxPlayers(listed.map((game) => game.igdbId)).catch(
    () => new Map<number, number>(),
  );
  for (const game of listed) game.maxPlayers = limits.get(game.igdbId) ?? null;

  const byTitle = (a: PartyGame, b: PartyGame) => a.title.localeCompare(b.title);

  return {
    code: party.code,
    name: party.name,
    memberCount: party.members.length,
    expiresAt: expiresAt(party).toISOString(),
    isHost: party.hostId === userId,
    // User IDs stay on the server. Members know each other only by display name.
    members: party.members.map((member) => ({
      displayName: member.displayName,
      isYou: member.userId === userId,
      isHost: member.userId === party.hostId,
    })),
    shared: shared.sort(byTitle),
    almost: almost.sort(byTitle),
  };
}

export async function leaveParty(userId: string, code: string): Promise<void> {
  const party = await findParty(code);

  // A party without its host would have nobody able to end it.
  if (party.hostId === userId) {
    throw new AppError(
      409,
      "PARTY_HOST_CANNOT_LEAVE",
      "You started this party, so you cannot leave it. End the party instead.",
    );
  }

  const { count } = await prisma.partyMember.deleteMany({ where: { partyId: party.id, userId } });

  if (count === 0) throw notFound();
}

// Ends a party for everyone. Only the player who started it may do this.
export async function endParty(userId: string, code: string): Promise<void> {
  const party = await findParty(code);

  if (party.hostId !== userId) {
    throw new AppError(403, "PARTY_NOT_HOST", "Only the player who started this party can end it.");
  }

  // Deleting the party deletes its memberships with it.
  await prisma.party.delete({ where: { id: party.id } });
}

// Called when an account is deleted: ends the parties they host, and takes them out of the rest.
export async function leaveAllParties(userId: string): Promise<void> {
  await prisma.party.deleteMany({ where: { hostId: userId } });
  await prisma.partyMember.deleteMany({ where: { userId } });
}
