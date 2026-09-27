import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimits, rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimits();
  });

  it("allows requests under the limit", () => {
    for (let i = 0; i < 3; i += 1) {
      const result = rateLimit("k", 3, 60_000);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks once the limit is exceeded", () => {
    for (let i = 0; i < 5; i += 1) rateLimit("k", 5, 60_000);
    expect(rateLimit("k", 5, 60_000).allowed).toBe(false);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 5; i += 1) rateLimit("a", 5, 60_000);
    expect(rateLimit("a", 5, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 5, 60_000).allowed).toBe(true);
  });

  it("reports remaining allowance", () => {
    expect(rateLimit("k", 3, 60_000).remaining).toBe(2);
    expect(rateLimit("k", 3, 60_000).remaining).toBe(1);
    expect(rateLimit("k", 3, 60_000).remaining).toBe(0);
  });

  it("returns a positive retryAfter when blocked", () => {
    for (let i = 0; i < 2; i += 1) rateLimit("k", 2, 60_000);
    const blocked = rateLimit("k", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("starts a fresh window after the previous one expires", async () => {
    // A 1ms window expires immediately, exercising the reset branch.
    for (let i = 0; i < 2; i += 1) rateLimit("k", 2, 1);
    expect(rateLimit("k", 2, 1).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rateLimit("k", 2, 1).allowed).toBe(true);
  });
});
