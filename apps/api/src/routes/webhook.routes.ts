import express, { Router } from "express";
import { clerkWebhook } from "../controllers/webhook.controller";

const router = Router();

// The signature is checked against the exact bytes Clerk sent, so the body stays unparsed.
router.post("/clerk", express.raw({ type: "application/json" }), clerkWebhook);

export default router;
