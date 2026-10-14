import type { Request, Response } from "express";
import { PartyCodeParamSchema } from "../schemas/party.schema";
import { getPartyPreview, INACTIVE_PREVIEW } from "../services/party-preview.service";

export async function preview(req: Request, res: Response) {
  const parsed = PartyCodeParamSchema.safeParse(req.params);

  // A malformed code gets the same answer as an unknown one, with no validation message.
  const data = parsed.success ? await getPartyPreview(parsed.data.code) : INACTIVE_PREVIEW;

  res.status(200).json({ data });
}
