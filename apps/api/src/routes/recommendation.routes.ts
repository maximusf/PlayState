import { Router } from "express";
import { recommend } from "../controllers/recommendation.controller";
import { requireUser } from "../middleware/auth.middleware";

const router = Router();

router.post("/", requireUser, recommend);

export default router;
