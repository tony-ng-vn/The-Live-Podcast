import { getLLMProvider } from "../src/lib/llm";
import type { Message } from "../src/lib/llm/types";

/**
 * Single-shot LLM call for Convex actions.
 *
 * Delegates to the shared provider factory in src/lib/llm so Convex-side
 * calls honour the same LLM_PROVIDER selection (openai | ollama | openrouter)
 * and credentials as the Next.js chat route. Previously this had its own
 * client that silently fell back to Ollama for any non-OpenAI provider.
 */
export async function chatWithLLM(
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  return getLLMProvider().chat(messages, options);
}
