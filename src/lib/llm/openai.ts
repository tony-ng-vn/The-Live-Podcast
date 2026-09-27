import { LLMProvider, Message, LLMOptions } from "./types";
import { modelProviderError } from "./provider-error";

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    apiKey?: string,
    baseUrl = "https://api.openai.com/v1",
    defaultModel = "gpt-4o-mini"
  ) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || this.defaultModel,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw modelProviderError("OpenAI", response.status, data.error, this.apiKey, response.statusText);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async *stream(
    messages: Message[],
    options?: LLMOptions
  ): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || this.defaultModel,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
        stream: true,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw modelProviderError("OpenAI", response.status, data.error, this.apiKey, response.statusText);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.error) {
          throw modelProviderError("OpenAI", Number(parsed.error.code) || 503, parsed.error, this.apiKey);
        }
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }
}
