import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "../../../src/lib/llm/openrouter";
import { OpenAIProvider } from "../../../src/lib/llm/openai";

const providers = [
  ["OpenRouter", () => new OpenRouterProvider({ apiKey: "private-test-key" })],
  ["OpenAI", () => new OpenAIProvider("private-test-key")],
] as const;

afterEach(() => vi.unstubAllGlobals());

for (const [name, create] of providers) {
  describe(`${name} failures`, () => {
    it.each([
      [401, "invalid_api_key", "MODEL_KEY_INVALID"],
      [402, "insufficient_credits", "MODEL_CREDITS_REQUIRED"],
      [429, "rate_limit_exceeded", "MODEL_RATE_LIMITED"],
      [429, "insufficient_quota", "MODEL_CREDITS_REQUIRED"],
      [503, "provider_unavailable", "MODEL_UNAVAILABLE"],
    ])("classifies HTTP %s with %s", async (status, code, expected) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
        error: { code, message: "Provider refused private-test-key" },
      }, { status })));
      const stream = create().stream([{ role: "user", content: "Hello" }]);
      await expect(stream.next()).rejects.toMatchObject({ code: expected });
      await expect(create().chat([{ role: "user", content: "Hello" }])).rejects.not.toThrow("private-test-key");
    });

    it("propagates an error inside an HTTP 200 stream", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
        'data: {"choices":[{"delta":{"content":"Started"}}]}\n\n' +
        'data: {"error":{"code":429,"message":"Rate limited"}}\n\n' +
        'data: [DONE]\n\n',
      )));
      const stream = create().stream([{ role: "user", content: "Hello" }]);
      await expect(stream.next()).resolves.toMatchObject({ value: "Started" });
      await expect(stream.next()).rejects.toMatchObject({ code: "MODEL_RATE_LIMITED" });
    });
  });
}
