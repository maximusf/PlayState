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

const router = Router();

router.use(requireUser);

router.get("/", list);
// Listed before "/:id" so "count" is not read as a library item ID.
router.get("/count", count);
router.get("/:id", detail);
router.post("/", add);
router.post("/import", importMany);
router.post("/import/steam", previewSteam);
router.patch("/:id", updateSessionLength);
router.delete("/:id", remove);

export default router;
