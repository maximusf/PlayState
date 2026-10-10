import { Router } from "express";
import { add, list, remove } from "../controllers/library.controller";
import { requireUser } from "../middleware/auth.middleware";

const router = Router();

router.use(requireUser);

router.get("/", list);
router.post("/", add);
router.delete("/:id", remove);

export default router;
