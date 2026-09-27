"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

export interface SendOptions {
  episodeId: string;
  podcasterId: string;
  currentTimestamp: number;
  /** Called on every token, for progressive rendering. */
  onToken?: (fullContent: string) => void;
}

export interface UseChatStreamResult {
  messages: ChatTurn[];
  streaming: boolean;
  conversationId: string | null;
  /** Resolves with the full assistant reply, or null if the turn failed. */
  send: (text: string, options: SendOptions) => Promise<string | null>;
  retry: (assistantIndex: number, options: SendOptions) => Promise<string | null>;
  reset: () => void;
}

/**
 * Owns the conversation transcript and the SSE stream lifecycle.
 *
 * ChatPanel and VoiceConversation previously each implemented their own copy of
 * this logic, so switching between text and voice mode destroyed the transcript
 * and started a brand-new server-side conversation. Both surfaces now share one
 * history and one conversation id.
 *
 * Three invariants matter here and are all easy to break:
 *
 *  1. `nextIndexRef` is the authoritative append position, maintained
 *     synchronously by `send` and `reset`. It cannot be derived from React
 *     state: `streamResponse` calls `setStreaming`, which parks a render lane,
 *     and React then defers subsequent `setMessages` updaters to the render
 *     phase. A ref mirroring `messages` therefore goes stale for every
 *     `send` after the first in a given tick, and two sends would write both
 *     replies into the same bubble.
 *
 *  2. `epochRef` increments on `reset`. A stream that was in flight when the
 *     viewer hit Resume belongs to a conversation that no longer exists, so it
 *     must not write into the new one — a role check cannot catch that, since
 *     the slot is legitimately an assistant turn in both conversations.
 *
 *  3. `send` resolves with the assembled reply rather than expecting the caller
 *     to find it in `messages`. Callers that run from a long-lived callback
 *     (voice mode's synthesis handler) would otherwise read a stale snapshot.
 *
 * Streams are aborted on unmount and when a new turn starts, so navigating away
 * or hitting Resume stops the LLM call instead of leaving it running.
 */
export function useChatStream(): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatTurn[]>([]);
  // Authoritative next append position. See invariant 1 above.
  const nextIndexRef = useRef(0);
  // Bumped on reset; see invariant 2 above.
  const epochRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /**
   * Applies a state update and keeps the read-only mirror in step. The mirror
   * exists for `retry` lookups, which are always user-triggered after a render;
   * append positions come from `nextIndexRef` instead.
   */
  const updateMessages = useCallback(
    (updater: (prev: ChatTurn[]) => ChatTurn[]): void => {
      setMessages((prev) => {
        const next = updater(prev);
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const streamResponse = useCallback(
    async (
      userMessage: string,
      assistantIndex: number,
      options: SendOptions,
    ): Promise<string | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Captured so a reset mid-stream can invalidate this turn's writes.
      const epoch = epochRef.current;

      setStreaming(true);

      const failWith = (message: string) => {
        updateMessages((prev) => {
          const updated = [...prev];
          const existing = updated[assistantIndex];
          if (!existing || existing.role !== "assistant") return prev;
          updated[assistantIndex] = {
            role: "assistant",
            content: existing.content || message,
            error: true,
          };
          return updated;
        });
        return null;
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            episodeId: options.episodeId,
            podcasterId: options.podcasterId,
            timestamp: options.currentTimestamp,
            message: userMessage,
            conversationId: conversationIdRef.current,
          }),
        });

        if (!res.ok || !res.body) {
          const payload = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            payload?.error ?? "Failed to get a response. Please try again.",
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            let parsed: ChatStreamEvent;
            try {
              parsed = JSON.parse(line.slice(6)) as ChatStreamEvent;
            } catch {
              continue;
            }

            if (parsed.type === "conversation") {
              // Epoch-guarded: a stale stream must not retarget the next
              // message at a conversation the viewer has already abandoned.
              if (epoch === epochRef.current) {
                conversationIdRef.current = parsed.conversationId;
                setConversationId(parsed.conversationId);
              }
              continue;
            }

            if (parsed.type === "token") {
              // Check staleness before any observable effect, including the
              // caller's token callback.
              if (epoch !== epochRef.current) return null;
              fullContent += parsed.content;
              options.onToken?.(fullContent);
              const index = assistantIndex;
              updateMessages((prev) => {
                const updated = [...prev];
                const msg = updated[index];
                // Guard: if the index no longer points at an assistant turn the
                // turn was reset or replaced, so do not write into it.
                if (msg && msg.role === "assistant") {
                  updated[index] = { ...msg, content: msg.content + parsed.content };
                }
                return updated;
              });
              continue;
            }

            if (parsed.type === "error") {
              throw new Error(parsed.message);
            }
          }
        }

        if (epoch !== epochRef.current) return null;

        updateMessages((prev) => {
          const updated = [...prev];
          const msg = updated[assistantIndex];
          if (msg && msg.role === "assistant" && msg.error) {
            updated[assistantIndex] = { ...msg, error: false };
          }
          return updated;
        });

        return fullContent;
      } catch (error) {
        // An abort is a deliberate user action, not a failure to surface.
        if (controller.signal.aborted) return null;
        // Same for a turn whose conversation was reset out from under it.
        if (epoch !== epochRef.current) return null;

        const message =
          error instanceof Error
            ? error.message
            : "Connection error. Please try again.";
        toast.error(message);
        return failWith(message);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [updateMessages],
  );

  const send = useCallback(
    async (text: string, options: SendOptions): Promise<string | null> => {
      const trimmed = text.trim();
      if (!trimmed) return null;

      // Claim the slot synchronously. Reading React state here would race with
      // a deferred updater and hand two sends the same slot.
      // `nextIndexRef` counts messages already claimed, and this turn claims
      // two (user, then assistant), so the assistant lands at +1.
      const assistantIndex = nextIndexRef.current + 1;
      nextIndexRef.current += 2;

      updateMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ]);

      return streamResponse(trimmed, assistantIndex, options);
    },
    [streamResponse, updateMessages],
  );

  const retry = useCallback(
    async (
      assistantIndex: number,
      options: SendOptions,
    ): Promise<string | null> => {
      // An index carried over from before a reset would silently retry the
      // wrong turn, so require the slot and its predecessor to be intact.
      if (assistantIndex <= 0 || assistantIndex >= nextIndexRef.current) {
        return null;
      }
      const target = messagesRef.current[assistantIndex];
      if (!target || target.role !== "assistant") return null;

      const userMessage = messagesRef.current[assistantIndex - 1];
      if (!userMessage || userMessage.role !== "user") return null;

      updateMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIndex]?.role === "assistant") {
          updated[assistantIndex] = { role: "assistant", content: "" };
        }
        return updated;
      });

      return streamResponse(userMessage.content, assistantIndex, options);
    },
    [streamResponse, updateMessages],
  );

  const reset = useCallback(() => {
    // Invalidate any in-flight turn before clearing, so it cannot write into
    // the fresh transcript.
    epochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    conversationIdRef.current = null;
    messagesRef.current = [];
    nextIndexRef.current = 0;
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
  }, []);

  return { messages, streaming, conversationId, send, retry, reset };
}
