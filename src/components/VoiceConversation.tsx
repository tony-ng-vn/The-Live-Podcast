"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechRecognitionService } from "@/lib/voice/speech-recognition";
import { SpeechSynthesisService } from "@/lib/voice/speech-synthesis";
import { useChatStream, type SendOptions } from "@/hooks/use-chat-stream";

type VoiceState = "idle" | "listening" | "processing" | "speaking";

interface VoiceConversationProps {
  /** Shared history so switching to text mode keeps the conversation. */
  chat: ReturnType<typeof useChatStream>;
  sendOptions: SendOptions;
  onMicError?: () => void;
  onUserInteraction?: () => void;
  /** Toggled off when the viewer switches to text mode. */
  active: boolean;
}

export default function VoiceConversation({
  chat,
  sendOptions,
  onMicError,
  onUserInteraction,
  active,
}: VoiceConversationProps) {
  const { send } = chat;
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionService | null>(null);
  const synthesisRef = useRef<SpeechSynthesisService | null>(null);
  const mountedRef = useRef(true);

  // The send options change every time the pause timestamp moves, so the
  // services read them through refs. Capturing them in the callbacks is what
  // previously made the setup effect re-run mid-utterance, which set
  // mountedRef to false and cancelled synthesis the instant TTS started.
  // Refs are synced in effects: writing them during render is unsafe in React 19.
  const sendOptionsRef = useRef(sendOptions);
  const mutedRef = useRef(muted);
  const activeRef = useRef(active);

  useEffect(() => {
    sendOptionsRef.current = sendOptions;
  }, [sendOptions]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const voiceStateRef = useRef(voiceState);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  const lastAssistantText = useRef("");
  const speakRef = useRef<(text: string) => void>(() => {});
  const onMicErrorRef = useRef(onMicError);
  const sendRef = useRef(send);

  useEffect(() => {
    onMicErrorRef.current = onMicError;
  }, [onMicError]);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /**
   * Deliberately has no reactive dependencies. Everything it needs is read
   * through refs, so a single instance stays valid for the component's
   * lifetime.
   *
   * This must NOT depend on `messages` or `send`: the synthesis effect below is
   * mount-only, so it captures whatever instance of this callback existed on
   * the first render. When it depended on `messages`, every reply was appended
   * into the first assistant bubble and TTS never fired at all.
   */
  const startListening = useCallback(() => {
    if (!mountedRef.current || mutedRef.current || !activeRef.current) return;

    setTranscript("");
    setVoiceState("listening");

    const recognition = new SpeechRecognitionService({
      onResult: (text, isFinal) => {
        if (!mountedRef.current) return;
        setTranscript(text);

        if (!isFinal) return;

        setVoiceState("processing");
        recognition.stop();

        void sendRef
          .current(text, sendOptionsRef.current)
          .catch(() => null)
          .then((reply) => {
            if (!mountedRef.current) return;
            // The viewer may have switched to text mode while this streamed.
            if (!activeRef.current) return;
            if (!reply) {
              setVoiceState("idle");
              return;
            }
            // `send` resolves with the assembled reply, so no stale `messages`
            // read is needed here.
            lastAssistantText.current = reply;
            setVoiceState("speaking");
            speakRef.current(reply);
          });
      },
      onError: (error) => {
        if (!mountedRef.current) return;
        if (error === "not-allowed" || error === "audio-capture") {
          onMicErrorRef.current?.();
        }
        setVoiceState("idle");
      },
      onEnd: () => {
        // Recognition can end without a final result (silence timeout). Stay
        // idle and let the viewer re-activate rather than looping the mic.
        if (!mountedRef.current) return;
        if (voiceStateRef.current === "listening") {
          setVoiceState("idle");
        }
      },
    });

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  // Initialise synthesis once. The synthesis service is created exactly once
  // for the lifetime of the component; only its callbacks are refreshed.
  useEffect(() => {
    mountedRef.current = true;

    const synthesis = new SpeechSynthesisService({
      onEnd: () => {
        if (!mountedRef.current) return;
        setVoiceState("idle");
        // Resume the conversation loop once TTS finishes.
        startListening();
      },
      onError: () => {
        if (!mountedRef.current) return;
        setVoiceState("idle");
      },
    });

    synthesisRef.current = synthesis;
    speakRef.current = (text: string) => {
      synthesis.speak(text);
    };

    return () => {
      mountedRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      synthesis.cancel();
      synthesisRef.current = null;
    };
    // Intentionally mount-only: the callbacks read current values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving voice mode must stop the mic and any speech immediately.
  useEffect(() => {
    if (active) return;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    synthesisRef.current?.cancel();
    setVoiceState("idle");
  }, [active]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (next) {
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        setVoiceState((state) => (state === "listening" ? "idle" : state));
      }
      return next;
    });
  }, []);

  const activate = useCallback(() => {
    if (voiceState !== "idle") return;
    onUserInteraction?.();
    startListening();
  }, [voiceState, startListening, onUserInteraction]);

  const indicator = {
    idle: {
      ring: "bg-zinc-100 dark:bg-zinc-800",
      icon: "text-zinc-400 dark:text-zinc-500",
    },
    listening: {
      ring: "bg-red-100 dark:bg-red-900/30",
      icon: "text-red-500",
    },
    processing: null,
    speaking: null,
  }[voiceState];

  return (
    <div
      className="flex h-full flex-col items-center gap-4 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      role="region"
      aria-label="Voice conversation"
    >
      <div className="flex flex-col items-center gap-2">
        {indicator && (
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full ${indicator.ring} ${
              voiceState === "listening" ? "animate-pulse" : ""
            }`}
          >
            <svg
              className={`h-8 w-8 ${indicator.icon}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          </div>
        )}

        {voiceState === "processing" && (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100"
              role="status"
              aria-label="Processing your message"
            />
          </div>
        )}

        {voiceState === "speaking" && (
          <div className="flex h-16 w-16 items-center justify-center gap-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30">
            {[4, 6, 8, 6, 4].map((height, index) => (
              <span
                key={index}
                className="inline-block w-1 animate-[voice-wave_0.8s_ease-in-out_infinite] rounded-full bg-blue-500"
                style={{ height: `${height * 4}px`, animationDelay: `${index * 0.15}s` }}
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        <p
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          aria-live="polite"
        >
          {voiceState === "idle" && (muted ? "Muted" : "Ready")}
          {voiceState === "listening" && "Listening…"}
          {voiceState === "processing" && "Thinking…"}
          {voiceState === "speaking" && "Speaking…"}
        </p>
      </div>

      {transcript && voiceState === "listening" && (
        <p className="max-w-full text-center text-sm text-zinc-700 dark:text-zinc-300">
          {transcript}
        </p>
      )}

      {lastAssistantText.current && voiceState === "speaking" && (
        <p className="max-h-32 max-w-full overflow-y-auto text-center text-sm text-zinc-700 dark:text-zinc-300">
          {lastAssistantText.current}
        </p>
      )}

      <div className="flex items-center gap-3">
        {voiceState === "idle" && !muted && (
          <button
            type="button"
            onClick={activate}
            aria-label="Start voice conversation"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-50"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
            Tap to speak
          </button>
        )}

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          className={`inline-flex items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-50 ${
            muted
              ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
        >
          {muted ? (
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
