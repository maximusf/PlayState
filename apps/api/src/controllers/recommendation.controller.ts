import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import { RecommendationSchema } from "../schemas/recommendation.schema";
import { getPickerOptions, recommendGames } from "../services/recommendation.service";

export async function options(_req: Request, res: Response) {
  const pickerOptions = await getPickerOptions(getUserId(res));

  res.status(200).json({ data: pickerOptions });
}

export async function recommend(req: Request, res: Response) {
  const input = RecommendationSchema.parse(req.body);
  const recommendations = await recommendGames(getUserId(res), input);

  res.status(200).json({ data: { recommendations } });
}
