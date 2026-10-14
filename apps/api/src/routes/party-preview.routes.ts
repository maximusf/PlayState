import { Router } from "express";
import { preview } from "../controllers/party-preview.controller";
import { publicRateLimit } from "../middleware/public-rate-limit.middleware";

// Public on purpose: link crawlers are not signed in. No requireUser here.
const router = Router();

// The web server fetches previews on behalf of crawlers, so this is a generous
// ceiling that stops scraping without blocking a busy chat channel.
router.get(
  "/:code/preview",
  publicRateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: "Too many requests. Try again in a minute.",
  }),
  preview,
);

export default router;
