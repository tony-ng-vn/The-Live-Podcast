import type { AuthConfig } from "convex/server";

/**
 * Configures the JWT issuer Convex uses to verify `Authorization` headers on
 * requests from the ConvexHttpClient.
 *
 * Set the deployment env var to your Clerk issuer, e.g.
 *   npx convex env set CONVEX_AUTH_DOMAIN https://your-app.clerk.accounts.dev
 *
 * With this in place, `ctx.auth.getUserIdentity()` is populated for HTTP
 * callers that pass a valid Clerk session token, and remains null otherwise.
 * Every public Convex function must therefore treat args as untrusted.
 */
const authConfig: AuthConfig = {
  providers: [
    {
      domain: process.env.CONVEX_AUTH_DOMAIN ?? "",
      applicationID: "convex",
    },
  ],
};

export default authConfig;
