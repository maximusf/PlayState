import { Router } from "express";
import { list, send } from "../controllers/reaction.controller";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";

// Mounted at /api/parties/:code/reactions, so the party code is passed down.
const router = Router({ mergeParams: true });

router.use(requireUser);

const sendLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 10,
  message: "You are reacting too quickly. Wait a moment and try again.",
});

router.get("/", list);
router.post("/", sendLimit, send);

export default router;
