import { Router } from "express";
import { list, send } from "../controllers/party-chat.controller";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";

// Mounted at /api/parties/:code/messages, so it needs the code from the parent path.
const router = Router({ mergeParams: true });

router.use(requireUser);

// Chat is only ever read and added to. There is deliberately no route to edit or delete a
// message, for the host or anyone else. A party's messages go when the party does.
const sendLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: "You are sending messages too quickly. Wait a moment and try again.",
});

router.get("/", list);
router.post("/", sendLimit, send);

export default router;
