/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the voice loop.
 *
 * The original implementation had `startListening` depend on `messages` while
 * the synthesis effect that calls it was mount-only. The mount-only effect
 * therefore captured the render-0 closure, whose `messages` was permanently
 * `[]`. Every reply was appended into the first assistant bubble and the spoken
 * output stayed empty forever. These tests drive real turns through mocked
 * speech services and assert on what actually got spoken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SendOptions } from "@/hooks/use-chat-stream";

const spoken: string[] = [];
const recognition: {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  handlers: {
    onResult?: (text: string, isFinal: boolean) => void;
    onError?: (error: string) => void;
    onEnd?: () => void;
  };
} = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  handlers: {},
};

const speakMock = vi.fn((text: string) => {
  spoken.push(text);
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/voice/speech-recognition", () => ({
  SpeechRecognitionService: class {
    constructor(handlers: typeof recognition.handlers) {
      recognition.handlers = handlers;
    }
    start = recognition.start;
    stop = recognition.stop;
    abort = recognition.abort;
    static isSupported() {
      return true;
    }
  },
}));

vi.mock("@/lib/voice/speech-synthesis", () => ({
  SpeechSynthesisService: class {
    constructor(handlers: {
      onEnd?: () => void;
      onError?: (e: string) => void;
    }) {
      this.handlers = handlers;
    }
    handlers: { onEnd?: () => void; onError?: (e: string) => void } = {};
    speak = speakMock;
    cancel = vi.fn();
    static isSupported() {
      return true;
    }
  },
}));

import VoiceConversation from "@/components/VoiceConversation";

const options: SendOptions = {
  episodeId: "ep1",
  podcasterId: "pod1",
  currentTimestamp: 30,
};

/** Minimal stand-in for useChatStream, tracking the shared history. */
function makeChat(replyFor: (message: string) => string) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  return {
    messages,
    streaming: false,
    conversationId: "conv_1",
    reset: vi.fn(),
    retry: vi.fn(),
    send: vi.fn(async (text: string) => {
      messages.push({ role: "user", content: text });
      const reply = replyFor(text);
      messages.push({ role: "assistant", content: reply });
      return reply;
    }),
  };
}

type Chat = ReturnType<typeof makeChat>;

function renderVoice(chat: Chat, active = true) {
  return render(
    <VoiceConversation
      chat={chat as unknown as ReturnType<typeof import("@/hooks/use-chat-stream").useChatStream>}
      sendOptions={options}
      active={active}
    />,
  );
}

/** Simulates the viewer speaking, the API replying, and TTS finishing. */
async function speakTurn(chat: Chat, text: string, reply: string) {
  await act(async () => {
    recognition.handlers.onResult?.(text, false);
    recognition.handlers.onResult?.(text, true);
  });
  await waitFor(() => {
    expect(chat.send).toHaveBeenCalledWith(text, options);
  });
  await waitFor(() => {
    expect(spoken).toContain(reply);
  });
}

describe("VoiceConversation", () => {
  beforeEach(() => {
    spoken.length = 0;
    recognition.start.mockClear();
    recognition.stop.mockClear();
    recognition.abort.mockClear();
    recognition.handlers = {};
    speakMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle and offers to speak", () => {
    renderVoice(makeChat(() => "x"));
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("speaks the reply for a single turn", async () => {
    const chat = makeChat(() => "ANSWER1");
    renderVoice(chat);

    await userEvent.click(
      screen.getByRole("button", { name: /start voice conversation/i }),
    );
    expect(recognition.start).toHaveBeenCalled();

    await speakTurn(chat, "one", "ANSWER1");
  });

  /**
   * The core regression: three turns must produce three spoken replies and
   * three separate assistant entries — not one bubble accumulating every
   * answer while TTS stays silent.
   */
  it("speaks each reply across three consecutive turns", async () => {
    let turn = 0;
    const chat = makeChat(() => `ANSWER${++turn}`);
    renderVoice(chat);

    await userEvent.click(
      screen.getByRole("button", { name: /start voice conversation/i }),
    );

    for (let i = 1; i <= 3; i += 1) {
      await speakTurn(chat, `q${i}`, `ANSWER${i}`);

      // TTS finishing resumes the loop.
      await act(async () => {
        recognition.handlers.onEnd?.();
      });
    }

    expect(spoken).toEqual(["ANSWER1", "ANSWER2", "ANSWER3"]);
    expect(chat.messages.filter((m) => m.role === "assistant")).toHaveLength(3);
  });

  it("does not speak a reply when switched to text mid-response", async () => {
    let resolveSend: ((value: string | null) => void) | undefined;
    const chat = makeChat(() => "LATE");
    chat.send.mockImplementation(
      () => new Promise<string | null>((resolve) => (resolveSend = resolve)),
    );

    const { rerender } = renderVoice(chat);

    await userEvent.click(
      screen.getByRole("button", { name: /start voice conversation/i }),
    );

    await act(async () => {
      recognition.handlers.onResult?.("hello", true);
    });

    // Viewer switches to text mode before the response lands.
    rerender(
      <VoiceConversation
        chat={chat as unknown as ReturnType<typeof import("@/hooks/use-chat-stream").useChatStream>}
        sendOptions={options}
        active={false}
      />,
    );

    await act(async () => {
      resolveSend?.("LATE");
    });

    // Hearing a voice reply in text mode, with nothing on screen, is a bug.
    expect(spoken).not.toContain("LATE");
  });

  it("aborts recognition when deactivated", async () => {
    const chat = makeChat(() => "x");
    const { rerender } = renderVoice(chat, true);

    await userEvent.click(
      screen.getByRole("button", { name: /start voice conversation/i }),
    );
    expect(recognition.start).toHaveBeenCalled();

    rerender(
      <VoiceConversation
        chat={chat as unknown as ReturnType<typeof import("@/hooks/use-chat-stream").useChatStream>}
        sendOptions={options}
        active={false}
      />,
    );

    await waitFor(() => {
      expect(recognition.abort).toHaveBeenCalled();
    });
  });

  it("reports a mic permission failure to the parent", async () => {
    const onMicError = vi.fn();
    const chat = makeChat(() => "x");

    render(
      <VoiceConversation
        chat={chat as unknown as ReturnType<typeof import("@/hooks/use-chat-stream").useChatStream>}
        sendOptions={options}
        onMicError={onMicError}
        active
      />,
    );

    // The recognition service only exists once listening starts, so the
    // handlers are registered by activating the mic first.
    await userEvent.click(
      screen.getByRole("button", { name: /start voice conversation/i }),
    );

    await act(async () => {
      recognition.handlers.onError?.("not-allowed");
    });

    expect(onMicError).toHaveBeenCalled();
  });

  it("toggles mute and stops the mic", async () => {
    const chat = makeChat(() => "x");
    renderVoice(chat);

    await userEvent.click(
      screen.getByRole("button", { name: /start voice conversation/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /mute microphone/i }),
    );

    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.getByText("Muted")).toBeTruthy();
  });
});
