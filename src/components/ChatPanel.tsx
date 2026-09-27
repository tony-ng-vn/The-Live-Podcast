"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useChatStream, type ChatTurn } from "@/hooks/use-chat-stream";

interface ChatPanelProps {
  episodeId: string;
  podcasterId: string;
  currentTimestamp: number;
  /** Shared history so switching to voice mode keeps the conversation. */
  chat: ReturnType<typeof useChatStream>;
  onUserInteraction?: () => void;
}

export default function ChatPanel({
  episodeId,
  podcasterId,
  currentTimestamp,
  chat,
  onUserInteraction,
}: ChatPanelProps) {
  const { messages, streaming, send, retry } = chat;
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Pause auto-scroll when the viewer scrolls up to read earlier turns.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 60;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendOptions = useMemo(
    () => ({ episodeId, podcasterId, currentTimestamp }),
    [episodeId, podcasterId, currentTimestamp],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    onUserInteraction?.();
    setInput("");
    await send(trimmed, sendOptions);
  }, [input, streaming, onUserInteraction, send, sendOptions]);

  const handleRetry = useCallback(
    async (assistantIndex: number) => {
      if (streaming) return;
      await retry(assistantIndex, sendOptions);
    },
    [streaming, retry, sendOptions],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Chat
        </h2>
      </div>

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-500">
            Ask a question about this episode…
          </p>
        )}
        {messages.map((msg: ChatTurn, i) => (
          <div
            key={i}
            className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[85%]">
              <div
                className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {msg.role === "assistant" && msg.content === "" && streaming && !msg.error ? (
                  <div
                    className="flex items-center gap-1 py-1"
                    aria-label="Typing"
                  >
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "300ms" }} />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
              {msg.error && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-red-500 dark:text-red-400">
                    Failed to send
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRetry(i)}
                    disabled={streaming}
                    className="text-xs font-medium text-zinc-600 underline hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              onUserInteraction?.();
              setInput(e.target.value);
            }}
            onFocus={() => onUserInteraction?.()}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus-visible:outline-zinc-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
            aria-label="Send message"
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
