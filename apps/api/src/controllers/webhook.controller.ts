import type { Request, Response } from "express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { AppError } from "../lib/errors";
import { deleteLibrary } from "../services/library.service";
import { leaveAllParties } from "../services/party.service";

// Clerk calls this when something happens to an account. The signature check proves the
// request came from Clerk, so the user ID in it can be trusted.
export async function clerkWebhook(req: Request, res: Response) {
  const event = await verifyWebhook(req).catch(() => {
    throw new AppError(400, "WEBHOOK_INVALID", "Webhook signature could not be verified.");
  });

  // When an account is deleted, its library and party memberships go with it.
  if (event.type === "user.deleted" && event.data.id) {
    await deleteLibrary(event.data.id);
    await leaveAllParties(event.data.id);
  }

  // Any other event is acknowledged so Clerk does not keep retrying it.
  res.status(200).json({ data: { received: true } });
}
