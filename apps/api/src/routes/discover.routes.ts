import { Router } from "express";
import { discover } from "../controllers/discover.controller";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";

const router = Router();

router.use(requireUser);

// A visit that is not already remembered spends up to two IGDB requests, and IGDB's limit is
// shared by every player. Reloading and flipping the mature switch stay well under this.
router.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: "You are discovering games too quickly. Wait a few minutes and try again.",
  }),
);

router.get("/", discover);

export default router;
