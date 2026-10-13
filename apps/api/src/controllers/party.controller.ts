import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import {
  CreatePartySchema,
  JoinPartySchema,
  PartyCodeParamSchema,
  PartyMemberParamSchema,
  RenamePartySchema,
  RollSchema,
} from "../schemas/party.schema";
import {
  createParty,
  endParty,
  getInvite,
  getParty,
  getPartyVersion,
  joinParty,
  leaveParty,
  listParties,
  recordRoll,
  removeMember,
  renameParty,
} from "../services/party.service";

export async function list(_req: Request, res: Response) {
  res.status(200).json({ data: await listParties(getUserId(res)) });
}

export async function create(req: Request, res: Response) {
  const { name, displayName } = CreatePartySchema.parse(req.body);
  const party = await createParty(getUserId(res), name, displayName);

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
  const { igdbId } = RollSchema.parse(req.body);

  res.status(200).json({ data: await recordRoll(getUserId(res), code, igdbId) });
}

export async function rename(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { name } = RenamePartySchema.parse(req.body);

  res.status(200).json({ data: await renameParty(getUserId(res), code, name) });
}

export async function remove(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { memberId } = PartyMemberParamSchema.parse(req.params);
  await removeMember(getUserId(res), code, memberId);

  res.status(204).end();
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
