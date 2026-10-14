import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import { DiscoverQuerySchema } from "../schemas/discover.schema";
import { discoverGames } from "../services/discover.service";

export async function discover(req: Request, res: Response) {
  const { mature } = DiscoverQuerySchema.parse(req.query);
  const result = await discoverGames(getUserId(res), mature);

  res.status(200).json({ data: result });
}
