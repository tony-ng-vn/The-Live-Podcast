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
 * Two invariants matter here and are easy to break:
 *
 *  1. `messagesRef` mirrors `messages` synchronously. Callers that need the
 *     index of the pending assistant turn must read the ref, not the render
 *     closure — two `send` calls in one render window would otherwise compute
 *     the same index and write both replies into the same bubble.
 *
 *  2. `send` resolves with the assembled reply rather than expecting the caller
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /**
   * Applies a state update and keeps the mirror ref in step within the same
   * tick, so a caller can immediately read the post-update list.
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
              conversationIdRef.current = parsed.conversationId;
              setConversationId(parsed.conversationId);
              continue;
            }

            if (parsed.type === "token") {
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

      // Read the mirror ref, not the render closure: two sends within one
      // render window must land on different assistant slots.
      const assistantIndex = messagesRef.current.length + 1;

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
    abortRef.current?.abort();
    abortRef.current = null;
    conversationIdRef.current = null;
    messagesRef.current = [];
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
  }, []);

  return { messages, streaming, conversationId, send, retry, reset };
}
