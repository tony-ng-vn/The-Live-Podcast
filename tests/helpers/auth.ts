import { vi } from "vitest";

export const TEST_AUTH_TOKEN = "test-jwt-token";

/**
 * The shape `auth()` returns that route handlers depend on.
 *
 * `getToken` is required: routes now build a token-bound Convex client so that
 * Convex can verify identity via `ctx.auth`. A mock that omits it makes every
 * authenticated route return 503.
 */
export function authResult(userId: string | null) {
  return {
    userId,
    getToken: vi.fn(async () => (userId ? TEST_AUTH_TOKEN : null)),
  };
}
