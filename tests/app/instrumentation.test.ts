import { describe, expect, it, vi } from "vitest";

const { recordServerErrorMock } = vi.hoisted(() => ({
  recordServerErrorMock: vi.fn().mockResolvedValue("error-test-id"),
}));

vi.mock("@/lib/server-error", () => ({ recordServerError: recordServerErrorMock }));

import { onRequestError } from "../../src/instrumentation";

describe("server error instrumentation", () => {
  it("records uncaught library failures with their route", async () => {
    const error = new Error("Clerk service unavailable");
    await onRequestError(
      error,
      {} as Parameters<typeof onRequestError>[1],
      { routePath: "/library", routeType: "render" } as Parameters<typeof onRequestError>[2],
    );

    expect(recordServerErrorMock).toHaveBeenCalledWith("render:/library", error);
  });
});
