/**
 * Auth error messages shared between the Convex layer and the HTTP layer.
 *
 * ConvexHttpClient only surfaces `ConvexError`'s message, not its `data`, so
 * route handlers must classify auth failures by matching these strings. Keeping
 * them here means both sides import the same values instead of drifting apart.
 */
export const UNAUTHENTICATED_MESSAGE = "Unauthenticated";

export const FORBIDDEN_EPISODE_MESSAGE =
  "Episode does not belong to the authenticated user";
export const FORBIDDEN_CONVERSATION_MESSAGE =
  "Conversation does not belong to the authenticated user";
export const FORBIDDEN_PODCASTER_MESSAGE =
  "You do not have any episodes for this podcaster";
