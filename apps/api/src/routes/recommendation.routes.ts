import { Router } from "express";
import { options, recommend } from "../controllers/recommendation.controller";
import { requireUser } from "../middleware/auth.middleware";

const router = Router();

router.get("/options", requireUser, options);
router.post("/", requireUser, recommend);

export default router;
