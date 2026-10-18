export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "GAME_NOT_FOUND"
  | "GAME_ALREADY_ADDED"
  | "LIBRARY_ITEM_NOT_FOUND"
  | "EMPTY_LIBRARY"
  | "IGDB_UNAVAILABLE"
  | "STEAM_UNAVAILABLE"
  | "STEAM_PROFILE_NOT_FOUND"
  | "STEAM_LIBRARY_HIDDEN"
  | "WEBHOOK_INVALID"
  | "PARTY_NOT_FOUND"
  | "PARTY_NOT_JOINED"
  | "PARTY_FULL"
  | "PARTY_LIMIT_REACHED"
  | "PARTY_NOT_HOST"
  | "PARTY_HOST_CANNOT_LEAVE"
  | "PARTY_MEMBER_NOT_FOUND"
  | "PARTY_ALREADY_HOST"
  | "PARTY_ALREADY_EXTENDED"
  | "PARTY_REMOVED"
  | "PARTY_GAME_NOT_SHARED"
  | "PARTY_GAME_NOT_PLAYABLE"
  | "PARTY_GAME_NOT_NOMINATED"
  | "NOMINATION_LIMIT"
  | "RATE_LIMITED"
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
