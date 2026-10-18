import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import { PartyCodeParamSchema } from "../schemas/party.schema";
import { ReactionsQuerySchema, SendReactionSchema } from "../schemas/reaction.schema";
import { listReactions, sendReaction } from "../services/reaction.service";

export async function send(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { emoji } = SendReactionSchema.parse(req.body);

  res.status(201).json({ data: await sendReaction(getUserId(res), code, emoji) });
}

export async function list(req: Request, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { after } = ReactionsQuerySchema.parse(req.query);

  res.status(200).json({ data: await listReactions(getUserId(res), code, after) });
}
