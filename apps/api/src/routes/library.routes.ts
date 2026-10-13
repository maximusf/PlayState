import { Router } from "express";
import {
  add,
  detail,
  importMany,
  list,
  previewSteam,
  remove,
  updateSessionLength,
} from "../controllers/library.controller";
import { requireUser } from "../middleware/auth.middleware";

const router = Router();

router.use(requireUser);

router.get("/", list);
router.get("/:id", detail);
router.post("/", add);
router.post("/import", importMany);
router.post("/import/steam", previewSteam);
router.patch("/:id", updateSessionLength);
router.delete("/:id", remove);

export default router;
