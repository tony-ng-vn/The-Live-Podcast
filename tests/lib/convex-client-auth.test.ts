import { afterEach, describe, expect, it, vi } from "vitest";

const { clientConstructor } = vi.hoisted(() => ({ clientConstructor: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: clientConstructor }));

import { getAuthenticatedConvexClient } from "../../src/lib/convex/client";

describe("authenticated Convex HTTP client", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires a Clerk Convex token", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    const getToken = vi.fn().mockResolvedValue(null);
    await expect(getAuthenticatedConvexClient(getToken)).rejects.toThrow("Convex token");
    expect(clientConstructor).not.toHaveBeenCalled();
  });

  it("creates a separate client for each user's verified token", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    clientConstructor.mockClear();
    const getTokenA = vi.fn().mockResolvedValue("token-a");
    const getTokenB = vi.fn().mockResolvedValue("token-b");

    await getAuthenticatedConvexClient(getTokenA);
    await getAuthenticatedConvexClient(getTokenB);

    expect(getTokenA).toHaveBeenCalledWith({ template: "convex" });
    expect(clientConstructor).toHaveBeenNthCalledWith(1, "https://example.convex.cloud", { auth: "token-a" });
    expect(clientConstructor).toHaveBeenNthCalledWith(2, "https://example.convex.cloud", { auth: "token-b" });
  });
});
