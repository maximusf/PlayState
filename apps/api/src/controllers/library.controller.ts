import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import {
  AddLibraryGameSchema,
  ImportGamesSchema,
  LibraryItemParamSchema,
  SessionLengthSchema,
  SteamProfileSchema,
} from "../schemas/library.schema";
import {
  addGameToLibrary,
  countLibrary,
  getLibraryEntry,
  importGames,
  listLibrary,
  previewSteamImport,
  removeGameFromLibrary,
  setSessionLength,
} from "../services/library.service";

export async function list(_req: Request, res: Response) {
  const entries = await listLibrary(getUserId(res));

  res.status(200).json({ data: entries });
}

export async function count(_req: Request, res: Response) {
  res.status(200).json({ data: { count: await countLibrary(getUserId(res)) } });
}

export async function detail(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  const entry = await getLibraryEntry(getUserId(res), id);

  res.status(200).json({ data: entry });
}

export async function add(req: Request, res: Response) {
  const { igdbId } = AddLibraryGameSchema.parse(req.body);
  const entry = await addGameToLibrary(getUserId(res), igdbId);

  res.status(201).json({ data: entry });
}

// Looks up a Steam library and reports what could be imported. Saves nothing.
export async function previewSteam(req: Request, res: Response) {
  const { profile } = SteamProfileSchema.parse(req.body);
  const preview = await previewSteamImport(getUserId(res), profile);

  res.status(200).json({ data: preview });
}

export async function importMany(req: Request, res: Response) {
  const { igdbIds } = ImportGamesSchema.parse(req.body);
  const result = await importGames(getUserId(res), igdbIds);

  res.status(200).json({ data: result });
}

export async function updateSessionLength(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  const { sessionLength } = SessionLengthSchema.parse(req.body);
  const entry = await setSessionLength(getUserId(res), id, sessionLength);

  res.status(200).json({ data: entry });
}

export async function remove(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  await removeGameFromLibrary(getUserId(res), id);

  res.status(204).end();
}
