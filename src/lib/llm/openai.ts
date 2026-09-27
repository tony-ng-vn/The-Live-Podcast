import {
  assertOk,
  iterateLines,
  type LLMProvider,
  type LLMOptions,
  type Message,
} from "./types";

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    apiKey?: string,
    baseUrl = "https://api.openai.com/v1",
    defaultModel = "gpt-4o-mini",
  ) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  private body(messages: Message[], options: LLMOptions | undefined, stream: boolean) {
    return JSON.stringify({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      ...(stream ? { stream: true } : {}),
    });
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, options, false),
      signal: options?.signal,
    });

    await assertOk(response, "OpenAI");

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

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

    await assertOk(response, "OpenAI");

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
        // Skip malformed frames.
      }
    }
  }
}
