import {
  assertOk,
  iterateLines,
  type LLMProvider,
  type LLMOptions,
  type Message,
} from "./types";

/**
 * OpenRouter exposes an OpenAI-compatible chat completions API.
 *
 * Note: provider-level prompt caching is NOT requested here. The prompt is
 * already ordered so its stable prefix is cacheable (see
 * src/lib/chat/system-prompt.ts); OpenRouter applies caching per upstream
 * provider, which varies by model.
 */
export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  /**
   * Initializes the OpenRouter provider.
   * Priority: passed options > environment variables > hardcoded defaults.
   */
  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env.OPENROUTER_API_KEY || "";
    this.baseUrl =
      options?.baseUrl ||
      process.env.OPENROUTER_BASE_URL ||
      "https://openrouter.ai/api/v1";
    this.defaultModel =
      options?.model || process.env.OPENROUTER_MODEL || "openai/gpt-3.5-turbo";
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      // OpenRouter uses these for ranking/referral attribution.
      "HTTP-Referer": process.env.YOUR_SITE_URL || "http://localhost:3000",
      "X-OpenRouter-Title":
        process.env.YOUR_SITE_NAME || "The Live Podcast",
    };
  }

  private body(
    messages: Message[],
    options: LLMOptions | undefined,
    stream: boolean,
  ) {
    return JSON.stringify({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      ...(stream ? { stream: true } : {}),
    });
  }

  /** Standard chat completion (non-streaming). */
  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, options, false),
      signal: options?.signal,
    });

    await assertOk(response, "OpenRouter");

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** Streaming chat completion. Yields content chunks as they arrive. */
  async *stream(
    messages: Message[],
    options?: LLMOptions,
  ): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, options, true),
      signal: options?.signal,
    });

    await assertOk(response, "OpenRouter");

    if (!response.body) throw new Error("No response body");

    for await (const line of iterateLines(response.body)) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;

      const data = trimmed.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Heartbeat or malformed frame.
      }
    }
  }
}
