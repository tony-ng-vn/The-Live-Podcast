/**
 * Shared limits between the HTTP layer and the Convex layer.
 *
 * Kept in src/ so the API route and the Convex mutations enforce the same
 * bound — previously the route checked for emptiness and Convex checked
 * nothing, so an oversized message reached the database.
 */
export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_ASSISTANT_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH * 4;
