import { Router } from "express";
import { stats } from "../controllers/stats.controller";

const router = Router();

// Public: the totals carry no information about any one user.
router.get("/", stats);

export default router;
