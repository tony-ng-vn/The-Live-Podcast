/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the streaming hook. The bug this guards against is
 * structural: a callback that depends on changing state and is captured in a
 * long-lived effect will re-run that effect and tear down live resources.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

import { useChatStream } from "@/hooks/use-chat-stream";

/** Builds a ReadableStream of SSE frames from a list of event objects. */
function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const options = {
  episodeId: "ep1",
  podcasterId: "pod1",
  currentTimestamp: 30,
};

describe("useChatStream", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "conversation", conversationId: "conv_1" },
        { type: "token", content: "he" },
        { type: "token", content: "llo" },
        { type: "done" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends the user turn and streams the assistant reply", async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("what did they say?", options);
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    const [user, assistant] = result.current.messages;
    expect(user).toEqual({ role: "user", content: "what did they say?" });
    expect(assistant.content).toBe("hello");
    expect(assistant.error).toBeFalsy();
  });

  it("records the conversation id from the stream", async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("hi", options);
    });

    await waitFor(() => {
      expect(result.current.conversationId).toBe("conv_1");
    });
  });

  it("sends the conversation id back on the next turn", async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("first", options);
    });
    await act(async () => {
      await result.current.send("second", options);
    });

    const secondBody = JSON.parse(
      fetchMock.mock.calls[1][1].body as string,
    ) as { conversationId: string };

    expect(secondBody.conversationId).toBe("conv_1");
  });

  it("ignores a blank message", async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("   ", options);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it("surfaces an error and marks the turn retryable", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 }),
    );

    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("hi", options);
    });

    await waitFor(() => {
      expect(result.current.messages[1]?.error).toBe(true);
    });
    expect(result.current.messages[1]?.content).toContain("Rate limited");
  });

  it("surfaces a mid-stream error frame", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: "conversation", conversationId: "conv_1" },
        { type: "token", content: "partial" },
        { type: "error", message: "provider exploded" },
      ]),
    );

    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("hi", options);
    });

    await waitFor(() => {
      expect(result.current.messages[1]?.error).toBe(true);
    });
    // Whatever streamed before the failure is kept.
    expect(result.current.messages[1]?.content).toContain("partial");
  });

  it("retries using the preceding user message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    );

    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("original question", options);
    });
    await waitFor(() => {
      expect(result.current.messages[1]?.error).toBe(true);
    });

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: "conversation", conversationId: "conv_1" },
        { type: "token", content: "recovered" },
        { type: "done" },
      ]),
    );

    await act(async () => {
      await result.current.retry(1, options);
    });

    await waitFor(() => {
      expect(result.current.messages[1]?.content).toBe("recovered");
    });
    expect(result.current.messages[1]?.error).toBeFalsy();
  });

  it("aborts a still-in-flight request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;

    // Never resolves: the request is genuinely still in flight when we unmount.
    fetchMock.mockImplementation(
      async (_url: string, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return new Promise<Response>(() => {});
      },
    );

    const { result, unmount } = renderHook(() => useChatStream());

    void act(() => {
      void result.current.send("hi", options);
    });

    await waitFor(() => {
      expect(capturedSignal).toBeDefined();
    });
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    // Unmounting must not leave the request (and the LLM call) running.
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("clears state on reset", async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("hi", options);
    });
    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.conversationId).toBeNull();
  });

  it("streams tokens to an optional observer", async () => {
    const seen: string[] = [];

    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("hi", {
        ...options,
        onToken: (full) => seen.push(full),
      });
    });

    expect(seen).toEqual(["he", "hello"]);
  });
});
