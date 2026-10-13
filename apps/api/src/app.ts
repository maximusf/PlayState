import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import catalogRoutes from "./routes/catalog.routes";
import libraryRoutes from "./routes/library.routes";
import partyRoutes from "./routes/party.routes";
import recommendationRoutes from "./routes/recommendation.routes";
import statsRoutes from "./routes/stats.routes";
import webhookRoutes from "./routes/webhook.routes";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";

const app = express();

// Only the PlayState frontend may call this API from a browser.
// FRONTEND_URL accepts a comma-separated list of origins.
const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));

// Mounted before express.json() because webhook signatures need the raw request body.
app.use("/api/webhooks", webhookRoutes);

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

// Verifies the Clerk session token (if any) and attaches auth state.
// Routes that need a signed-in user add requireUser on top of this.
app.use(clerkMiddleware());

app.use("/api/catalog", catalogRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/parties", partyRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/stats", statsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
