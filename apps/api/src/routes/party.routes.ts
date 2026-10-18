import { Router } from "express";
import {
  create,
  detail,
  end,
  handOver,
  invite,
  join,
  leave,
  list,
  nominate,
  remove,
  roll,
  unnominate,
  setBackdrop,
  setHat,
  update,
  version,
} from "../controllers/party.controller";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";

const router = Router();

router.use(requireUser);

const TEN_MINUTES = 10 * 60 * 1000;

// Starting and ending parties in a loop would otherwise get around the hosting limit.
const createLimit = rateLimit({
  windowMs: TEN_MINUTES,
  max: 5,
  message: "You are starting parties too quickly. Wait a few minutes and try again.",
});
const rollLimit = rateLimit({
  windowMs: TEN_MINUTES,
  max: 120,
  message: "You are rolling too quickly. Wait a few minutes and try again.",
});
const nominateLimit = rateLimit({
  windowMs: TEN_MINUTES,
  max: 120,
  message: "You are nominating too quickly. Wait a few minutes and try again.",
});
const joinLimit = rateLimit({
  windowMs: TEN_MINUTES,
  max: 30,
  message: "You are joining parties too quickly. Wait a few minutes and try again.",
});

router.get("/", list);
router.post("/", createLimit, create);
router.get("/:code", detail);
router.patch("/:code", update);
router.delete("/:code", end);
router.get("/:code/invite", invite);
router.get("/:code/version", version);
router.post("/:code/host", handOver);
router.patch("/:code/me", setHat);
router.patch("/:code/backdrop", setBackdrop);
router.post("/:code/roll", rollLimit, roll);
router.post("/:code/nominations", nominateLimit, nominate);
router.delete("/:code/nominations/:igdbId", nominateLimit, unnominate);
router.post("/:code/members", joinLimit, join);
// "me" is matched before a member ID, so a player leaving is never read as a removal.
router.delete("/:code/members/me", leave);
router.delete("/:code/members/:memberId", remove);

export default router;
