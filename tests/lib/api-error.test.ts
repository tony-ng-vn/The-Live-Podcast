import { describe, expect, it } from "vitest";
import { readApiError } from "../../src/lib/api-error";

describe("readApiError", () => {
  it("uses the API's specific JSON error", async () => {
    const response = Response.json(
      { error: "Transcript service is unreachable" },
      { status: 422 },
    );
    expect(await readApiError(response)).toBe("Transcript service is unreachable");
  });

  it("explains an HTML server failure without showing HTML", async () => {
    const response = new Response("<html>Internal Server Error</html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
    expect(await readApiError(response)).toBe(
      "Oops, someone stole the apple. Please try again while I find another one.",
    );
  });

  it("hides a technical JSON error from the user", async () => {
    const response = Response.json(
      { error: "Convex deployment disabled: spending limit exceeded", errorId: "abc123" },
      { status: 503 },
    );
    expect(await readApiError(response)).toBe(
      "Oops, someone stole the apple. Please try again while I find another one.",
    );
  });
});
