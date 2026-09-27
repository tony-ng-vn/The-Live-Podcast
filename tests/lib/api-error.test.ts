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
      "The server returned HTTP 500. Check the terminal running npm run dev.",
    );
  });
});
