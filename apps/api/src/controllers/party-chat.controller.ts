import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import { ListMessagesQuerySchema, SendMessageSchema } from "../schemas/party-chat.schema";
import { PartyCodeParamSchema } from "../schemas/party.schema";
import { listMessages, sendMessage } from "../services/party-chat.service";

export async function list(req: Request<{ code: string }>, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { after } = ListMessagesQuerySchema.parse(req.query);

  res.status(200).json({ data: { messages: await listMessages(getUserId(res), code, after) } });
}

export async function send(req: Request<{ code: string }>, res: Response) {
  const { code } = PartyCodeParamSchema.parse(req.params);
  const { body } = SendMessageSchema.parse(req.body);

  res.status(201).json({ data: await sendMessage(getUserId(res), code, body) });
}
