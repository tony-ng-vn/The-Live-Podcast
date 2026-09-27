import { ConvexError } from "convex/values";
import type { GenericActionCtx } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import {
  FORBIDDEN_CONVERSATION_MESSAGE,
  FORBIDDEN_EPISODE_MESSAGE,
  FORBIDDEN_PODCASTER_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from "../src/lib/convex/auth-messages";

/**
 * Any Convex execution context. Auth is available on queries, mutations and
 * actions alike, so this only requires `auth`.
 */
type AuthContext = Pick<
  QueryCtx | MutationCtx | GenericActionCtx<DataModel>,
  "auth"
>;

/**
 * The authenticated Clerk user id, or null when the caller did not present a
 * verifiable session token.
 *
 * The app talks to Convex over `ConvexHttpClient`, which can only invoke public
 * functions — so public functions are the real trust boundary. Nothing may read
 * a user id from its arguments; it must come from here.
 */
export async function getAuthenticatedUserId(
  ctx: AuthContext,
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return identity.subject;
}

export class UnauthenticatedError extends ConvexError<string> {
  constructor() {
    super(UNAUTHENTICATED_MESSAGE);
  }
}

export class ForbiddenError extends ConvexError<string> {
  constructor(message = "You do not have access to this resource") {
    super(message);
  }
}

/** Asserts a verified Clerk session and returns its user id. */
export async function requireUserId(ctx: AuthContext): Promise<string> {
  const userId = await getAuthenticatedUserId(ctx);
  if (!userId) throw new UnauthenticatedError();
  return userId;
}

export { FORBIDDEN_CONVERSATION_MESSAGE, FORBIDDEN_EPISODE_MESSAGE, FORBIDDEN_PODCASTER_MESSAGE };
