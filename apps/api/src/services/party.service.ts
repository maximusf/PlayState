import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getMaxPlayers } from "./igdb.service";
import { hasAny, MULTIPLAYER_MODES } from "./preferences";

// Keeps one party small enough to compare quickly, and one account from creating endless parties.
const MAX_MEMBERS = 12;
// How many parties one player can be in at once, counting the ones they host.
const MAX_PARTIES_PER_USER = 3;
const HOUR_MS = 60 * 60 * 1000;
// The host picks how long a party lasts. The default is one evening of deciding what to play.
const DEFAULT_LIFETIME_HOURS = 24;
// How many games one member can have nominated at a time.
const MAX_NOMINATIONS = 2;

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
  // Whether the host has already used the one extension.
  // Whether the viewer started this party, and so can end it.
  isHost: boolean;
};

export type PartyInvite = PartySummary & {
  joined: boolean;
  // True when the host removed this player, who can then no longer join.
  removed: boolean;
};

export type PartyDetail = PartySummary & {
  // id names a member within this party. It is not the account ID, which stays on the server.
  members: { id: string; displayName: string; hatId: string | null; isYou: boolean; isHost: boolean }[];
  // Multiplayer games every member owns. libraryEntryId is the viewer's own entry.
  shared: (PartyGame & { libraryEntryId: string | null })[];
  // Multiplayer games all but one member owns, and who is missing each.
  almost: (PartyGame & { missing: string; missingIsYou: boolean })[];
  // The viewer's own multiplayer games that fit neither list. Only ever their own library.
  others: PartyGame[];
  // The host's latest dice roll, so every member sees the same result.
  rolledIgdbId: number | null;
  rolledAt: string | null;
  // The server clock when this was sent, so every browser can start the dice together.
  serverNow: string;
  // The host's setting: games too small for the group still count as playable.
  ignoreLimits: boolean;
  // Games members put forward for the next roll. memberId matches an entry in members.
  nominations: { igdbId: number; memberId: string }[];
  // The host's picture for the top of the party page. Null means none.
  backdropId: string | null;
  // Changes whenever the party does. The page checks it to know when to reload.
  version: string;
};

export type PartyNominations = { nominations: PartyDetail["nominations"]; version: string };

export type PartySettings = { name: string; ignoreLimits: boolean; version: string };

// serverNow is the server clock when the answer was made, so browsers can line their dice up.
export type PartyRoll = { rolledIgdbId: number; rolledAt: string; serverNow: string; version: string };

function times(party: { expiresAt: Date }) {
  return { expiresAt: party.expiresAt.toISOString() };
}

// Expired parties are removed whenever someone lists, starts or joins one, so no
// scheduled job is needed. Deleting a party deletes its memberships with it.
async function deleteExpiredParties(): Promise<void> {
  await prisma.party.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
}

type VersionedParty = {
  name: string;
  hostId: string;
  rolledIgdbId: number | null;
  rolledAt: Date | null;
  ignoreLimits: boolean;
  expiresAt: Date;
  backdropId: string | null;
  members: { id: string; displayName: string; hatId: string | null }[];
  nominations: { userId: string; igdbId: number }[];
};

// A short fingerprint of everything members can see change: the name, the host,
// who is in the party, the latest roll, and the host's settings.
function versionOf(party: VersionedParty): string {
  const visible = [
    party.name,
    party.hostId,
    party.rolledIgdbId,
    party.rolledAt?.getTime() ?? null,
    party.ignoreLimits,
    party.expiresAt.getTime(),
    party.members.map((member) => [member.id, member.displayName, member.hatId]),
    party.nominations.map((nomination) => [nomination.userId, nomination.igdbId]),
    party.backdropId,
  ];

  return createHash("sha256").update(JSON.stringify(visible)).digest("base64url").slice(0, 16);
}

function requireMember(party: { members: { userId: string }[] }, userId: string): void {
  // Only members may see who is in a party and what they own in common.
  if (!party.members.some((member) => member.userId === userId)) {
    throw new AppError(403, "PARTY_NOT_JOINED", "Join this party to see its games.");
  }
}

function notFound(): AppError {
  return new AppError(404, "PARTY_NOT_FOUND", "That party could not be found.");
}

async function findParty(code: string) {
  const party = await prisma.party.findUnique({
    where: { code },
    include: {
      members: { orderBy: { joinedAt: "asc" } },
      nominations: { orderBy: { createdAt: "asc" } },
    },
  });

  // An expired party that has not been cleaned up yet is treated as gone.
  if (!party || party.expiresAt.getTime() <= Date.now()) throw notFound();

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
    ...times(party),
    isHost: party.hostId === userId,
  }));
}

export async function createParty(
  userId: string,
  name: string,
  displayName: string,
  lifetimeHours: number = DEFAULT_LIFETIME_HOURS,
): Promise<PartySummary> {
  await deleteExpiredParties();

  if ((await prisma.partyMember.count({ where: { userId } })) >= MAX_PARTIES_PER_USER) {
    throw new AppError(
      409,
      "PARTY_LIMIT_REACHED",
      `You can be in ${MAX_PARTIES_PER_USER} parties at a time. Leave one to start another.`,
    );
  }

  const party = await prisma.party.create({
    data: {
      // 72 random bits. The code is the only thing protecting the invite, so it must not be guessable.
      code: randomBytes(9).toString("base64url"),
      name,
      hostId: userId,
      expiresAt: new Date(Date.now() + lifetimeHours * HOUR_MS),
      members: { create: { userId, displayName } },
    },
  });

  return {
    code: party.code,
    name: party.name,
    memberCount: 1,
    ...times(party),
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
    ...times(party),
    isHost: party.hostId === userId,
    joined: party.members.some((member) => member.userId === userId),
    removed: party.removedUserIds.includes(userId),
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

  if (party.removedUserIds.includes(userId)) {
    throw new AppError(403, "PARTY_REMOVED", "The host removed you from this party.");
  }

  if (!alreadyIn && party.members.length >= MAX_MEMBERS) {
    throw new AppError(409, "PARTY_FULL", `This party is full. A party holds ${MAX_MEMBERS} players.`);
  }

  if (!alreadyIn && (await prisma.partyMember.count({ where: { userId } })) >= MAX_PARTIES_PER_USER) {
    throw new AppError(
      409,
      "PARTY_LIMIT_REACHED",
      `You can be in ${MAX_PARTIES_PER_USER} parties at a time. Leave one to join this one.`,
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
    ...times(party),
    isHost: party.hostId === userId,
  };
}

export async function getParty(userId: string, code: string): Promise<PartyDetail> {
  const party = await findParty(code);
  requireMember(party, userId);

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
  const others: PartyDetail["others"] = [];

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
      if (missing) {
        almost.push({
          ...summary,
          missing: missing.displayName,
          missingIsYou: missing.userId === userId,
        });
      }
    } else if (userIds.has(userId)) {
      // A game of the viewer's own. Other members' unshared games are never listed.
      others.push(summary);
    }
  }

  // IGDB knows the player limit for most games, not all. A missing figure, or IGDB being
  // down, leaves maxPlayers null, and the game is still listed.
  const listed = [...shared, ...almost];
  const limits = await getMaxPlayers(listed.map((game) => game.igdbId)).catch(
    () => new Map<number, number>(),
  );
  for (const game of listed) game.maxPlayers = limits.get(game.igdbId) ?? null;

  // Only nominations by current members for games the party can still play together show.
  const playableIds = new Set(
    shared
      .filter((game) => party.ignoreLimits || game.maxPlayers === null || game.maxPlayers >= memberIds.length)
      .map((game) => game.igdbId),
  );
  const nominations = nominationsOf(
    party,
    party.nominations.filter((nomination) => playableIds.has(nomination.igdbId)),
  );

  const byTitle = (a: PartyGame, b: PartyGame) => a.title.localeCompare(b.title);

  return {
    code: party.code,
    name: party.name,
    memberCount: party.members.length,
    ...times(party),
    isHost: party.hostId === userId,
    // User IDs stay on the server. Members know each other only by display name.
    members: party.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      hatId: member.hatId,
      isYou: member.userId === userId,
      isHost: member.userId === party.hostId,
    })),
    shared: shared.sort(byTitle),
    almost: almost.sort(byTitle),
    others: others.sort(byTitle),
    rolledIgdbId: party.rolledIgdbId,
    rolledAt: party.rolledAt?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
    ignoreLimits: party.ignoreLimits,
    nominations,
    backdropId: party.backdropId,
    version: versionOf(party),
  };
}

// A cheap check the party page makes every few seconds. It reads one party and no libraries.
export async function getPartyVersion(userId: string, code: string): Promise<{ version: string }> {
  const party = await findParty(code);
  requireMember(party, userId);

  return { version: versionOf(party) };
}

// Records the game the host's dice landed on, so every member sees the same result.
// With two or more nominated games the roll comes from those alone, unless the host
// chose to roll from everything.
export async function recordRoll(
  userId: string,
  code: string,
  igdbId: number,
  fromAll = false,
): Promise<PartyRoll> {
  const party = await findParty(code);
  requireHost(party, userId, "roll the dice");

  // The game must be one every member owns and can play together. The host's browser
  // chose it, so it is checked here and not taken on trust.
  const memberIds = party.members.map((member) => member.userId);
  const owned = await prisma.userGame.findMany({
    where: { userId: { in: memberIds }, game: { igdbId } },
    include: { game: true },
  });
  const owners = new Set(owned.map((entry) => entry.userId));
  const multiplayer = owned.some((entry) => hasAny(entry.game.gameModes, MULTIPLAYER_MODES));

  if (owners.size !== memberIds.length || !multiplayer) {
    throw new AppError(
      409,
      "PARTY_GAME_NOT_SHARED",
      "That game is not one everyone in the party owns. Reload the party and roll again.",
    );
  }

  const nominatedIds = [...new Set(party.nominations.map((nomination) => nomination.igdbId))];

  if (!fromAll && nominatedIds.length >= 2) {
    const pool = await playableAmong(party, nominatedIds);

    if (pool.size >= 2 && !pool.has(igdbId)) {
      throw new AppError(
        409,
        "PARTY_GAME_NOT_NOMINATED",
        "The roll comes from the nominated games. Reload the party and roll again.",
      );
    }
  }

  const rolledAt = new Date();
  await prisma.party.update({ where: { id: party.id }, data: { rolledIgdbId: igdbId, rolledAt } });
  // The next round starts with no nominations.
  await prisma.partyNomination.deleteMany({ where: { partyId: party.id } });

  return {
    rolledIgdbId: igdbId,
    rolledAt: rolledAt.toISOString(),
    serverNow: new Date().toISOString(),
    version: versionOf({ ...party, rolledIgdbId: igdbId, rolledAt, nominations: [] }),
  };
}

type PartyWithMembers = { id: string; hostId: string; members: { userId: string }[] };

// When the host goes, the party passes to whoever has been in it longest. Members are
// listed in the order they joined. A host who is alone takes the party with them.
async function handOverOrEnd(party: PartyWithMembers, leavingHostId: string): Promise<void> {
  const nextHost = party.members.find((member) => member.userId !== leavingHostId);

  if (nextHost) {
    await prisma.party.update({ where: { id: party.id }, data: { hostId: nextHost.userId } });
  } else {
    await prisma.party.delete({ where: { id: party.id } });
  }
}

export async function leaveParty(userId: string, code: string): Promise<void> {
  const party = await findParty(code);

  if (!party.members.some((member) => member.userId === userId)) throw notFound();

  // The new host is in place before the old one goes, so the party is never without one.
  if (party.hostId === userId) await handOverOrEnd(party, userId);

  await prisma.partyMember.deleteMany({ where: { partyId: party.id, userId } });
  await prisma.partyNomination.deleteMany({ where: { partyId: party.id, userId } });
}

function requireHost(party: { hostId: string }, userId: string, action: string): void {
  if (party.hostId !== userId) {
    throw new AppError(403, "PARTY_NOT_HOST", `Only the player who started this party can ${action}.`);
  }
}

// Changes the party's name, its player limit setting, or both. Only what is sent changes.
export async function updateParty(
  userId: string,
  code: string,
  changes: { name?: string; ignoreLimits?: boolean },
): Promise<PartySettings> {
  const party = await findParty(code);
  requireHost(party, userId, "change its settings");

  await prisma.party.update({ where: { id: party.id }, data: changes });

  const updated = { ...party, ...changes };

  return {
    name: updated.name,
    ignoreLimits: updated.ignoreLimits,
    version: versionOf(updated),
  };
}

// Puts a hat on the player's own avatar, or takes it off with null. Nobody else's can be changed.
export async function setMemberHat(
  userId: string,
  code: string,
  hatId: string | null,
): Promise<{ hatId: string | null; version: string }> {
  const party = await findParty(code);
  // A removed player is no longer a member, so they cannot change anything here.
  requireMember(party, userId);

  const me = party.members.find((member) => member.userId === userId);
  if (!me) throw notFound();

  await prisma.partyMember.updateMany({ where: { id: me.id, partyId: party.id }, data: { hatId } });

  return {
    hatId,
    version: versionOf({
      ...party,
      members: party.members.map((member) => (member.id === me.id ? { ...member, hatId } : member)),
    }),
  };
}

// Sets the picture behind the top of the party page, or clears it with null. Host only.
export async function setPartyBackdrop(
  userId: string,
  code: string,
  backdropId: string | null,
): Promise<{ backdropId: string | null; version: string }> {
  const party = await findParty(code);
  requireHost(party, userId, "change the backdrop");

  await prisma.party.update({ where: { id: party.id }, data: { backdropId } });

  return { backdropId, version: versionOf({ ...party, backdropId }) };
}

// Takes a player out of the party and stops them rejoining with the link.
export async function removeMember(userId: string, code: string, memberId: string): Promise<void> {
  const party = await findParty(code);
  requireHost(party, userId, "remove players");

  const member = party.members.find((candidate) => candidate.id === memberId);

  if (!member) {
    throw new AppError(404, "PARTY_MEMBER_NOT_FOUND", "That player is not in this party.");
  }

  if (member.userId === party.hostId) {
    throw new AppError(
      409,
      "PARTY_HOST_CANNOT_LEAVE",
      "You cannot remove yourself. End the party instead.",
    );
  }

  // Recorded first, so there is no moment where they are out but still able to rejoin.
  await prisma.party.update({
    where: { id: party.id },
    data: { removedUserIds: { push: member.userId } },
  });
  await prisma.partyMember.deleteMany({ where: { id: member.id, partyId: party.id } });
  await prisma.partyNomination.deleteMany({ where: { partyId: party.id, userId: member.userId } });
}

// Passes the party to another current member, without the host having to leave.
export async function transferHost(userId: string, code: string, memberId: string): Promise<void> {
  const party = await findParty(code);
  requireHost(party, userId, "hand it over");

  // A removed player is no longer a member, so they cannot be found here.
  const member = party.members.find((candidate) => candidate.id === memberId);

  if (!member || party.removedUserIds.includes(member.userId)) {
    throw new AppError(404, "PARTY_MEMBER_NOT_FOUND", "That player is not in this party.");
  }

  if (member.userId === party.hostId) {
    throw new AppError(409, "PARTY_ALREADY_HOST", "You are already the host.");
  }

  await prisma.party.update({ where: { id: party.id }, data: { hostId: member.userId } });
}

// Ends a party for everyone. Only the player who started it may do this.
export async function endParty(userId: string, code: string): Promise<void> {
  const party = await findParty(code);

  requireHost(party, userId, "end it");

  // Deleting the party deletes its memberships with it.
  await prisma.party.delete({ where: { id: party.id } });
}

// Called when an account is deleted. The parties they host pass to the next player,
// and they are taken out of every party.
export async function leaveAllParties(userId: string): Promise<void> {
  const hosted = await prisma.party.findMany({
    where: { hostId: userId },
    include: { members: { orderBy: { joinedAt: "asc" } } },
  });

  for (const party of hosted) await handOverOrEnd(party, userId);

  await prisma.partyMember.deleteMany({ where: { userId } });
  await prisma.partyNomination.deleteMany({ where: { userId } });
}

// Which of these games the whole party owns, can play together, and (unless the host
// ignores limits) has room for. Checked on the server, never taken on trust.
async function playableAmong(
  party: { members: { userId: string }[]; ignoreLimits: boolean },
  igdbIds: number[],
): Promise<Set<number>> {
  const memberIds = party.members.map((member) => member.userId);
  const entries = await prisma.userGame.findMany({
    where: { userId: { in: memberIds }, game: { igdbId: { in: igdbIds } } },
    include: { game: true },
  });

  const owners = new Map<number, Set<string>>();
  for (const entry of entries) {
    if (!hasAny(entry.game.gameModes, MULTIPLAYER_MODES)) continue;
    const set = owners.get(entry.game.igdbId) ?? new Set<string>();
    set.add(entry.userId);
    owners.set(entry.game.igdbId, set);
  }

  const shared = [...owners].filter(([, set]) => set.size === memberIds.length).map(([id]) => id);
  if (party.ignoreLimits || shared.length === 0) return new Set(shared);

  const limits = await getMaxPlayers(shared).catch(() => new Map<number, number>());

  return new Set(shared.filter((id) => (limits.get(id) ?? Infinity) >= memberIds.length));
}

// Swaps account IDs for the member IDs that are safe to send to the browser.
function nominationsOf(
  party: { members: { id: string; userId: string }[] },
  nominations: { userId: string; igdbId: number }[],
): PartyDetail["nominations"] {
  return nominations.flatMap((nomination) => {
    const nominator = party.members.find((member) => member.userId === nomination.userId);
    return nominator ? [{ igdbId: nomination.igdbId, memberId: nominator.id }] : [];
  });
}

// Puts a game forward for the next roll. Each member can have two at a time.
export async function nominateGame(
  userId: string,
  code: string,
  igdbId: number,
): Promise<PartyNominations> {
  const party = await findParty(code);
  requireMember(party, userId);

  let nominations: { userId: string; igdbId: number }[] = party.nominations;

  // Nominating a game again changes nothing.
  if (!nominations.some((n) => n.userId === userId && n.igdbId === igdbId)) {
    if (nominations.filter((n) => n.userId === userId).length >= MAX_NOMINATIONS) {
      throw new AppError(
        409,
        "NOMINATION_LIMIT",
        `You can nominate ${MAX_NOMINATIONS} games at a time. Remove one to nominate another.`,
      );
    }

    if (!(await playableAmong(party, [igdbId])).has(igdbId)) {
      throw new AppError(
        409,
        "PARTY_GAME_NOT_PLAYABLE",
        "That game is not one the whole party can play. Reload the party and try again.",
      );
    }

    await prisma.partyNomination.upsert({
      where: { partyId_userId_igdbId: { partyId: party.id, userId, igdbId } },
      create: { partyId: party.id, userId, igdbId },
      update: {},
    });
    nominations = [...nominations, { userId, igdbId }];
  }

  return { nominations: nominationsOf(party, nominations), version: versionOf({ ...party, nominations }) };
}

// Takes back one of the member's own nominations.
export async function removeNomination(
  userId: string,
  code: string,
  igdbId: number,
): Promise<PartyNominations> {
  const party = await findParty(code);
  requireMember(party, userId);

  await prisma.partyNomination.deleteMany({ where: { partyId: party.id, userId, igdbId } });

  const nominations = party.nominations.filter((n) => !(n.userId === userId && n.igdbId === igdbId));

  return { nominations: nominationsOf(party, nominations), version: versionOf({ ...party, nominations }) };
}
