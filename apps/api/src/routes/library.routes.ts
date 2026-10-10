import { Router } from "express";
import { add, detail, list, pick, remove, updateSessionLength } from "../controllers/library.controller";
import { requireUser } from "../middleware/auth.middleware";

const router = Router();

router.use(requireUser);

router.get("/", list);
router.get("/:id", detail);
router.post("/", add);
router.patch("/:id", updateSessionLength);
router.post("/:id/picks", pick);
router.delete("/:id", remove);

export default router;
