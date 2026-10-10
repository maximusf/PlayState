import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import { AddLibraryGameSchema, LibraryItemParamSchema } from "../schemas/library.schema";
import {
  addGameToLibrary,
  listLibrary,
  removeGameFromLibrary,
} from "../services/library.service";

export async function list(_req: Request, res: Response) {
  const entries = await listLibrary(getUserId(res));

  res.status(200).json({ data: entries });
}

export async function add(req: Request, res: Response) {
  const { igdbId } = AddLibraryGameSchema.parse(req.body);
  const entry = await addGameToLibrary(getUserId(res), igdbId);

  res.status(201).json({ data: entry });
}

export async function remove(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  await removeGameFromLibrary(getUserId(res), id);

  res.status(204).end();
}
