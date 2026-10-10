export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "GAME_NOT_FOUND"
  | "GAME_ALREADY_ADDED"
  | "LIBRARY_ITEM_NOT_FOUND"
  | "EMPTY_LIBRARY"
  | "IGDB_UNAVAILABLE"
  | "INTERNAL_ERROR";

// An error the API expects and knows how to describe to a client.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
