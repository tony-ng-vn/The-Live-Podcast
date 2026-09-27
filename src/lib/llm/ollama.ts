import {
  assertOk,
  iterateLines,
  type LLMProvider,
  type LLMOptions,
  type Message,
} from "./types";

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    baseUrl = "http://localhost:11434",
    defaultModel = "llama3.1",
  ) {
    this.baseUrl = process.env.OLLAMA_BASE_URL || baseUrl;
    this.defaultModel = process.env.OLLAMA_MODEL || defaultModel;
  }

  private body(messages: Message[], options: LLMOptions | undefined, stream: boolean) {
    return JSON.stringify({
      model: options?.model || this.defaultModel,
      messages,
      stream,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 2048,
      },
    });
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.body(messages, options, false),
      signal: options?.signal,
    });

    await assertOk(response, "Ollama");

    const data = (await response.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  async *stream(
    messages: Message[],
    options?: LLMOptions,
  ): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.body(messages, options, true),
      signal: options?.signal,
    });

    await assertOk(response, "Ollama");

    if (!response.body) throw new Error("No response body");

    // Ollama streams bare newline-delimited JSON, not SSE.
    for await (const line of iterateLines(response.body)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as {
          message?: { content?: string };
        };
        if (parsed.message?.content) {
          yield parsed.message.content;
        }
      } catch {
        // Skip malformed frames.
      }
    }
  }
}
