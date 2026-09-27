export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /**
   * Aborts the provider request. Wired through to `fetch`, so a client
   * disconnect stops the provider from generating tokens we will never read.
   */
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(messages: Message[], options?: LLMOptions): Promise<string>;
  stream(
    messages: Message[],
    options?: LLMOptions,
  ): AsyncGenerator<string, void, unknown>;
}

/** Shared error formatting so all providers report failures the same way. */
export async function assertOk(
  response: Response,
  provider: string,
): Promise<Response> {
  if (response.ok) return response;

  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string };
    };
    if (typeof body.error === "string") {
      detail = ` - ${body.error}`;
    } else if (body.error?.message) {
      detail = ` - ${body.error.message}`;
    }
  } catch {
    // Body was not JSON; the status line is enough.
  }

  throw new Error(
    `${provider} API error: ${response.status} ${response.statusText}${detail}`,
  );
}

/**
 * Iterates newline-delimited JSON or SSE frames, buffering partial lines.
 *
 * Shared by all three providers so the SSE parsing (and its edge cases) is
 * implemented once rather than three near-identical copies.
 */
export async function* iterateLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the trailing partial line for the next chunk.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        yield line;
      }
    }

    // Flush the decoder: a multi-byte character can straddle the final chunk
    // boundary and would otherwise be dropped.
    buffer += decoder.decode();

    // A last frame with no trailing newline is still a frame.
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    // Releasing the lock lets an aborted request tear the connection down.
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
  }
}
