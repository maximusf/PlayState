import type { Request, Response } from "express";
import { getUserId } from "../middleware/auth.middleware";
import {
  AddLibraryGameSchema,
  LibraryItemParamSchema,
  PickSchema,
  SessionLengthSchema,
} from "../schemas/library.schema";
import {
  addGameToLibrary,
  getLibraryEntry,
  listLibrary,
  recordPick,
  removeGameFromLibrary,
  setSessionLength,
} from "../services/library.service";

export async function list(_req: Request, res: Response) {
  const entries = await listLibrary(getUserId(res));

  res.status(200).json({ data: entries });
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

export async function updateSessionLength(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  const { sessionLength } = SessionLengthSchema.parse(req.body);
  const entry = await setSessionLength(getUserId(res), id, sessionLength);

  res.status(200).json({ data: entry });
}

export async function pick(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  const { availableTime } = PickSchema.parse(req.body);
  await recordPick(getUserId(res), id, availableTime);

  res.status(201).json({ data: { recorded: true } });
}

export async function remove(req: Request, res: Response) {
  const { id } = LibraryItemParamSchema.parse(req.params);
  await removeGameFromLibrary(getUserId(res), id);

  res.status(204).end();
}
