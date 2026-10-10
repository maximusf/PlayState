import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import { CatalogSearchSchema, IgdbIdParamSchema } from "../schemas/catalog.schema";
import { getGameDetails, searchGames } from "../services/igdb.service";

export async function search(req: Request, res: Response) {
  const { q } = CatalogSearchSchema.parse(req.query);
  const results = await searchGames(q);

  res.status(200).json({ data: results });
}

export async function getGame(req: Request, res: Response) {
  const { igdbId } = IgdbIdParamSchema.parse(req.params);
  const game = await getGameDetails(igdbId);

  if (!game) {
    throw new AppError(404, "GAME_NOT_FOUND", "That game could not be found.");
  }

  res.status(200).json({ data: game });
}
