import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import {
  CreatePartySchema,
  JoinPartySchema,
  NominateSchema,
  NominationParamSchema,
  PartyCodeParamSchema,
  PartyMemberParamSchema,
  RollSchema,
  TransferHostSchema,
  UpdatePartySchema,
} from "../schemas/party.schema";
import {
  createParty,
  endParty,
  extendParty,
  transferHost,
  getInvite,
  getParty,
  getPartyVersion,
  joinParty,
  leaveParty,
  listParties,
  nominateGame,
  recordRoll,
  removeMember,
  removeNomination,
  updateParty,
} from "../services/party.service";

export async function list(_req: Request, res: Response) {
  res.status(200).json({ data: await listParties(getUserId(res)) });
}

export async function create(req: Request, res: Response) {
  const { name, displayName, lifetimeHours } = CreatePartySchema.parse(req.body);
  const party = await createParty(getUserId(res), name, displayName, lifetimeHours);

  res.status(201).json({ data: party });
}

export async function invite(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);

  res.status(200).json({ data: await getInvite(getUserId(res), code) });
}

export async function join(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { displayName } = JoinPartySchema.parse(req.body);

  res.status(200).json({ data: await joinParty(getUserId(res), code, displayName) });
}

export async function detail(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);

  res.status(200).json({ data: await getParty(getUserId(res), code) });
}

export async function version(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);

  res.status(200).json({ data: await getPartyVersion(getUserId(res), code) });
}

export async function roll(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { igdbId, fromAll } = RollSchema.parse(req.body);

  res.status(200).json({ data: await recordRoll(getUserId(res), code, igdbId, fromAll) });
}

export async function nominate(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { igdbId } = NominateSchema.parse(req.body);

  res.status(200).json({ data: await nominateGame(getUserId(res), code, igdbId) });
}

export async function unnominate(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { igdbId } = NominationParamSchema.parse(req.params);

  res.status(200).json({ data: await removeNomination(getUserId(res), code, igdbId) });
}

export async function update(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const changes = UpdatePartySchema.parse(req.body);

  res.status(200).json({ data: await updateParty(getUserId(res), code, changes) });
}

export async function remove(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { memberId } = PartyMemberParamSchema.parse(req.params);
  await removeMember(getUserId(res), code, memberId);

  res.status(204).end();
}

export async function handOver(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { memberId } = TransferHostSchema.parse(req.body);
  await transferHost(getUserId(res), code, memberId);

  res.status(204).end();
}

export async function extend(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);

  res.status(200).json({ data: await extendParty(getUserId(res), code) });
}

export async function end(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  await endParty(getUserId(res), code);

  res.status(204).end();
}

export async function leave(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  await leaveParty(getUserId(res), code);

  res.status(204).end();
}
