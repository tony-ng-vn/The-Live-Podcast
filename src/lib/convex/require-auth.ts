import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { getConvexClient, isConvexConfigurationError } from "./client";

export { isConvexConfigurationError };

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface AuthedContext {
  userId: string;
  /**
   * Lazily constructed so a handler can validate its request body before paying
   * for a client. Accessing it builds a client bound to the session token.
   */
  readonly convex: ConvexHttpClient;
}

/**
 * Resolves the caller's Clerk identity and exposes a token-bound Convex client.
 *
 * Convex derives the user id from the verified token, never from request
 * arguments, so route handlers must not forward a client-supplied userId.
 *
 * Throws HttpError (401/503) so callers can `catch` and respond directly.
 */
export async function requireAuthedContext(): Promise<AuthedContext> {
  const { userId, getToken } = await auth();

  if (!userId) {
    throw new HttpError("Unauthorized", 401);
  }

  const authToken = await getToken();

  if (!authToken) {
    throw new HttpError(
      "Could not obtain a session token for the Convex client.",
      503,
    );
  }

  let cached: ConvexHttpClient | undefined;

  return {
    userId,
    get convex() {
      cached ??= getConvexClient(authToken);
      return cached;
    },
  };
}

export function toErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (isConvexConfigurationError(error)) {
    return Response.json({ error: error.message }, { status: 503 });
  }

  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 503 });
}

/**
 * Maps a Convex error message to an HTTP status.
 *
 * Convex propagates `ConvexError` data separately from the message, and
 * ConvexHttpClient only surfaces the message, so classification has to be
 * string-based. To keep that from drifting, both sides import the same
 * constants — see convex/auth.ts.
 */
export function statusForConvexError(message: string): number {
  if (message.includes(UNAUTHENTICATED_MARKER)) return 401;
  if (message.includes(FORBIDDEN_MARKER)) return 403;
  if (message.includes("not found")) return 404;
  return 400;
}

// Kept in sync with convex/auth.ts.
const UNAUTHENTICATED_MARKER = "Unauthenticated";
const FORBIDDEN_MARKER = "does not belong to";
