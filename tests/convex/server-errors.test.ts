import { afterEach, describe, expect, it, vi } from "vitest";
import { record } from "../../convex/serverErrors";

afterEach(() => vi.unstubAllEnvs());

describe("server error storage", () => {
  it("requires the private ingest token before writing", async () => {
    vi.stubEnv("ERROR_LOG_INGEST_TOKEN", "private-ingest-token");
    const insert = vi.fn();
    const handler = (record as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    })._handler;
    const entry = {
      id: "error-1",
      timestamp: "2026-09-27T19:00:00.000Z",
      source: "episodes.list",
      name: "Error",
      message: "Convex unavailable",
      stack: "Error: Convex unavailable",
    };

    await expect(handler({ db: { insert } }, { ...entry, token: "wrong" }))
      .rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();

    await handler({ db: { insert } }, { ...entry, token: "private-ingest-token" });
    expect(insert).toHaveBeenCalledWith("serverErrors", entry);
  });
});
