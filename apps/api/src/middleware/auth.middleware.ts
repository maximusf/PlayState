import type { RequestHandler, Response } from "express";
import { getAuth } from "@clerk/express";
import { AppError } from "../lib/errors";

// Rejects requests without a valid Clerk session and stores the verified
// user ID for controllers. The ID always comes from the session token.
export const requireUser: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);

  if (!userId) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
  }

  res.locals.userId = userId;
  next();
};

export function getUserId(res: Response): string {
  return res.locals.userId as string;
}
