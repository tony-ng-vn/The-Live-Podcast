import { describe, expect, it } from "vitest";
import { readApiError } from "../../src/lib/api-error";

describe("readApiError", () => {
  it("uses the API's specific JSON error", async () => {
    const response = Response.json(
      { error: "This video does not have captions I can read yet." },
      { status: 422 },
    );
    expect(await readApiError(response)).toBe("This video does not have captions I can read yet.");
  });

  it("explains an HTML server failure without showing HTML", async () => {
    const response = new Response("<html>Internal Server Error</html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
    expect(await readApiError(response)).toBe(
      "That request did not finish. Please try again.",
    );
  });

  it("hides a technical JSON error from the user", async () => {
    const response = Response.json(
      { error: "Convex deployment disabled: spending limit exceeded", errorId: "abc123" },
      { status: 503 },
    );
    expect(await readApiError(response)).toBe(
      "That request did not finish. Please try again.",
    );
  });
});


describe("safe public failure codes", () => {
  it("uses a recognized failure code without trusting the provider message", async () => {
    const response = Response.json({
      code: "TRANSCRIPT_UNAVAILABLE", error: "SerpApi key private-key exceeded quota",
    }, { status: 503 });
    expect(await readApiError(response)).toBe("I could not fetch this video's captions right now. Please try adding it again later.");
  });

  it("uses the default message for an unknown failure code", async () => {
    const response = Response.json({ code: "PRIVATE_BACKEND_FAILURE", error: "private-key" }, { status: 503 });
    expect(await readApiError(response)).toBe("That request did not finish. Please try again.");
  });
});
