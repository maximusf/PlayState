import { Router } from "express";
import { getGame, search } from "../controllers/catalog.controller";

const router = Router();

router.get("/search", search);
router.get("/games/:igdbId", getGame);

export default router;
