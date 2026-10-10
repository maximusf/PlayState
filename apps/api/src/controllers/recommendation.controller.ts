import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import { RecommendationSchema } from "../schemas/recommendation.schema";
import { recommendGames } from "../services/recommendation.service";

export async function recommend(req: Request, res: Response) {
  const input = RecommendationSchema.parse(req.body);
  const recommendations = await recommendGames(getUserId(res), input);

  res.status(200).json({ data: { recommendations } });
}
