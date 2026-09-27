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
  /** Called on every token so voice mode can begin speaking as text arrives. */
  onToken?: (fullContent: string) => void;
}

export interface UseChatStreamResult {
  messages: ChatTurn[];
  streaming: boolean;
  conversationId: string | null;
  send: (text: string, options: SendOptions) => Promise<void>;
  retry: (assistantIndex: number, options: SendOptions) => Promise<void>;
  reset: () => void;
}

/**
 * Owns the conversation transcript and the SSE stream lifecycle.
 *
 * ChatPanel and VoiceConversation previously each implemented their own copy of
 * this logic, which meant switching between text and voice mode destroyed the
 * transcript and silently started a brand-new server-side conversation. Both
 * surfaces now share one history and one conversation id.
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const streamResponse = useCallback(
    async (
      userMessage: string,
      assistantIndex: number,
      options: SendOptions,
    ): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStreaming(true);

      const failWith = (message: string) => {
        setMessages((prev) => {
          const updated = [...prev];
          const existing = updated[assistantIndex];
          if (!existing) return updated;
          updated[assistantIndex] = {
            role: "assistant",
            content: existing.content || message,
            error: true,
          };
          return updated;
        });
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
              setMessages((prev) => {
                const updated = [...prev];
                const msg = updated[assistantIndex];
                if (msg && msg.role === "assistant") {
                  updated[assistantIndex] = {
                    ...msg,
                    content: msg.content + parsed.content,
                  };
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

        setMessages((prev) => {
          const updated = [...prev];
          const msg = updated[assistantIndex];
          if (msg && msg.role === "assistant" && msg.error) {
            updated[assistantIndex] = { ...msg, error: false };
          }
          return updated;
        });
      } catch (error) {
        // An abort is a deliberate user action, not a failure to surface.
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error
            ? error.message
            : "Connection error. Please try again.";
        failWith(message);
        toast.error(message);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string, options: SendOptions): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // `messages` is current at call time, so the pending assistant turn lands
      // at messages.length + 1 after the user turn is appended.
      const assistantIndex = messages.length + 1;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ]);

      await streamResponse(trimmed, assistantIndex, options);
    },
    [messages.length, streamResponse],
  );

  const retry = useCallback(
    async (assistantIndex: number, options: SendOptions): Promise<void> => {
      const userMessage = messages[assistantIndex - 1];
      if (!userMessage || userMessage.role !== "user") return;

      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = { role: "assistant", content: "" };
        return updated;
      });

      await streamResponse(userMessage.content, assistantIndex, options);
    },
    [messages, streamResponse],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
  }, []);

  return { messages, streaming, conversationId, send, retry, reset };
}
