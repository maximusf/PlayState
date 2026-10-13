import { Router } from "express";
import {
  add,
  count,
  detail,
  importMany,
  list,
  previewSteam,
  remove,
  updateSessionLength,
} from "../controllers/library.controller";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";

const router = Router();

router.use(requireUser);

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// Each preview reads a whole Steam library and spends several IGDB requests on it.
// IGDB's limit is shared by every player, so one player looping this would slow search for all.
const previewAttemptLimit = rateLimit({
  windowMs: TEN_MINUTES,
  max: 10,
  message: "You are checking Steam profiles too quickly. Wait a few minutes and try again.",
});
// One import can carry thousands of games, each a possible IGDB lookup and database write.
const importAttemptLimit = rateLimit({
  windowMs: TEN_MINUTES,
  max: 20,
  message: "You are importing too quickly. Wait a few minutes and try again.",
});

// Few players have more than a couple of Steam accounts, so these are far stricter. They count
// only what worked: a mistyped link, a private profile or an import that added nothing is free,
// and the attempt limits above stop those being repeated without end.
const previewLimit = rateLimit({
  windowMs: ONE_HOUR,
  max: 5,
  successesOnly: true,
  message: "You have loaded 5 Steam libraries this hour. Try again later, or add games one at a time.",
});
const importLimit = rateLimit({
  windowMs: ONE_HOUR,
  max: 3,
  successesOnly: true,
  message: "You have imported 3 Steam libraries this hour. Try again later, or add games one at a time.",
});

router.get("/", list);
// Listed before "/:id" so "count" is not read as a library item ID.
router.get("/count", count);
router.get("/:id", detail);
router.post("/", add);
router.post("/import", importAttemptLimit, importLimit, importMany);
router.post("/import/steam", previewAttemptLimit, previewLimit, previewSteam);
router.patch("/:id", updateSessionLength);
router.delete("/:id", remove);

export default router;
