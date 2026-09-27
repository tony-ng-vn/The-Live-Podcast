import { describe, expect, it } from "vitest";
import { validateLocalSetup } from "../../scripts/check-local-setup.mjs";

const validPublishableKey =
  "pk_test_" + Buffer.from("clerk.example.com$").toString("base64");

describe("local setup check", () => {
  it("reports placeholder Clerk and Convex values before Next.js starts", () => {
    expect(
      validateLocalSetup({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_your-key-here",
        CLERK_SECRET_KEY: "sk_test_your-key-here",
        NEXT_PUBLIC_CONVEX_URL: "https://your-deployment.convex.cloud",
      }),
    ).toEqual([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a real Clerk publishable key.",
      "CLERK_SECRET_KEY must be a real Clerk secret key.",
      "NEXT_PUBLIC_CONVEX_URL must be a real Convex deployment URL.",
    ]);
  });

  it("accepts structurally valid development configuration", () => {
    expect(
      validateLocalSetup({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: validPublishableKey,
        CLERK_SECRET_KEY: `sk_test_${"a".repeat(48)}`,
        NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
      }),
    ).toEqual([]);
  });

  it("rejects short placeholder-like secret keys", () => {
    expect(
      validateLocalSetup({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: validPublishableKey,
        CLERK_SECRET_KEY: "sk_test_abc1234567",
        NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
      }),
    ).toEqual(["CLERK_SECRET_KEY must be a real Clerk secret key."]);
  });
});
