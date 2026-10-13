import { Router } from "express";
import { getGame, search } from "../controllers/catalog.controller";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";

const router = Router();

router.use(requireUser);

// IGDB allows the whole app 4 requests a second, so one player must not use them all.
// Searching as you type sends a handful of requests per game, well under this.
const catalogLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  message: "You are searching too quickly. Wait a minute and try again.",
});

router.use(catalogLimit);

router.get("/search", search);
router.get("/games/:igdbId", getGame);

export default router;
