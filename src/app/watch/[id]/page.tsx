"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "@/components/YouTubePlayer";
import ChatPanel from "@/components/ChatPanel";
import TranscriptPanel from "@/components/TranscriptPanel";
import VoiceConversation from "@/components/VoiceConversation";
import { useChatStream } from "@/hooks/use-chat-stream";
import { SpeechRecognitionService } from "@/lib/voice/speech-recognition";
import { SpeechSynthesisService } from "@/lib/voice/speech-synthesis";
import { formatClock } from "@/components/TranscriptPanel";

interface Episode {
  id: string;
  title: string;
  youtubeId: string;
  // A dangling podcasterId yields null from the API, so treat it as optional
  // rather than dereferencing blindly.
  podcaster: { id: string; name: string } | null;
}

const UNKNOWN_PODCASTER = { id: "", name: "Unknown podcaster" };

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatActive, setChatActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [micError, setMicError] = useState(false);
  const [chatTimestamp, setChatTimestamp] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const jumpInGuardRef = useRef(false);

  // One transcript, one conversation id, shared by both input modes.
  const chat = useChatStream();
  const { reset: resetChat } = chat;

  useEffect(() => {
    if (!params.id) {
      setError(true);
      setLoading(false);
      return;
    }

    async function fetchEpisode() {
      try {
        const res = await fetch(`/api/episodes/${params.id}`);
        if (!res.ok) {
          setError(true);
          toast.error("Failed to load episode.");
          setLoading(false);
          return;
        }
        setEpisode((await res.json()) as Episode);
      } catch {
        setError(true);
        toast.error("Failed to load episode. Please check your connection.");
      } finally {
        setLoading(false);
      }
    }

    void fetchEpisode();
  }, [params.id]);

  // Jump to the top when navigating between episodes.
  useEffect(() => {
    setChatActive(false);
    setVoiceMode(false);
    setMicError(false);
    setChatTimestamp(0);
    setPlayhead(0);
    setShowTranscript(false);
    resetChat();
  }, [params.id, resetChat]);

  const pauseVideoForInteraction = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const handleJumpIn = useCallback(() => {
    if (jumpInGuardRef.current || chatActive) return;
    jumpInGuardRef.current = true;

    const seconds = playerRef.current?.getCurrentTime() ?? 0;
    playerRef.current?.pause();
    setChatTimestamp(seconds);
    setPlayhead(seconds);

    const supportsVoice =
      SpeechRecognitionService.isSupported() && SpeechSynthesisService.isSupported();
    setVoiceMode(supportsVoice);
    setMicError(false);
    setChatActive(true);

    setTimeout(() => {
      jumpInGuardRef.current = false;
    }, 300);
  }, [chatActive]);

  const handleMicError = useCallback(() => {
    setMicError(true);
    setVoiceMode(false);
  }, []);

  const handleResume = useCallback(() => {
    if (jumpInGuardRef.current) return;
    jumpInGuardRef.current = true;

    setChatActive(false);
    setVoiceMode(false);
    setMicError(false);
    // Abort any in-flight stream so the LLM call is not left running.
    resetChat();
    playerRef.current?.play();

    setTimeout(() => {
      jumpInGuardRef.current = false;
    }, 300);
  }, [resetChat]);

  const podcaster = episode?.podcaster ?? UNKNOWN_PODCASTER;

  const sendOptions = useMemo(
    () => ({
      episodeId: episode?.id ?? "",
      podcasterId: podcaster.id,
      currentTimestamp: chatTimestamp,
    }),
    [episode?.id, podcaster.id, chatTimestamp],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="mb-4 h-6 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mb-6 h-4 w-1/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="aspect-video w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-4 h-10 w-28 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error || !episode) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-32 text-center sm:px-6">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Episode not found
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          The episode you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        <Link
          href="/library"
          className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-50"
        >
          Back to Library
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-white dark:bg-zinc-950">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-xl">
            {episode.title}
          </h1>
          <span
            className="font-mono text-sm tabular-nums text-zinc-500 dark:text-zinc-400"
            aria-label="Current playback position"
          >
            {formatClock(playhead)}
          </span>
        </div>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          {podcaster.name}
        </p>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div
            className={
              chatActive
                ? "w-full lg:sticky lg:top-6 lg:z-10 lg:self-start lg:w-[60%]"
                : "w-full"
            }
          >
            <YouTubePlayer
              ref={playerRef}
              videoId={episode.youtubeId}
              onTimeUpdate={setPlayhead}
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!chatActive && (
                <button
                  type="button"
                  onClick={handleJumpIn}
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                    />
                  </svg>
                  Jump In
                </button>
              )}

              {chatActive && (
                <button
                  type="button"
                  onClick={() => void handleResume()}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:focus-visible:outline-zinc-50"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                    />
                  </svg>
                  Resume
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowTranscript((prev) => !prev)}
                aria-expanded={showTranscript}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:focus-visible:outline-zinc-50"
              >
                {showTranscript ? "Hide transcript" : "Show transcript"}
              </button>
            </div>

            {showTranscript && (
              <div className="mt-4 h-[420px]">
                <TranscriptPanel
                  episodeId={episode.id}
                  currentTime={playhead}
                  disabled={false}
                  onSeek={(seconds) => {
                    playerRef.current?.seekTo(seconds);
                    setPlayhead(seconds);
                    setChatTimestamp(seconds);
                  }}
                />
              </div>
            )}
          </div>

          <div
            className={`${
              chatActive ? "flex" : "hidden"
            } h-[500px] w-full flex-col gap-3 lg:h-[calc(100vh-8rem)] lg:min-h-[500px] lg:w-[40%]`}
          >
            {chatActive && (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      voiceMode
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                    aria-label={voiceMode ? "Voice mode active" : "Text mode active"}
                  >
                    {voiceMode ? "Voice" : "Text"}
                  </span>

                  {voiceMode && (
                    <button
                      type="button"
                      onClick={() => setVoiceMode(false)}
                      className="text-xs text-zinc-500 underline hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-300 dark:focus-visible:outline-zinc-50"
                    >
                      Switch to text
                    </button>
                  )}

                  {!voiceMode &&
                    !micError &&
                    SpeechRecognitionService.isSupported() && (
                      <button
                        type="button"
                        onClick={() => {
                          pauseVideoForInteraction();
                          setVoiceMode(true);
                        }}
                        className="text-xs text-zinc-500 underline hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-300 dark:focus-visible:outline-zinc-50"
                      >
                        Switch to voice
                      </button>
                    )}
                </div>

                {micError && (
                  <div
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                    role="alert"
                  >
                    Microphone access was denied. Using text chat instead.
                  </div>
                )}

                {/* Both modes stay mounted so switching preserves the transcript. */}
                <div className={voiceMode ? "hidden" : "flex-1"}>
                  <ChatPanel
                    episodeId={episode.id}
                    podcasterId={podcaster.id}
                    currentTimestamp={chatTimestamp}
                    chat={chat}
                    onUserInteraction={pauseVideoForInteraction}
                  />
                </div>

                <div className={voiceMode ? "flex-1" : "hidden"}>
                  <VoiceConversation
                    chat={chat}
                    sendOptions={sendOptions}
                    active={voiceMode}
                    onMicError={handleMicError}
                    onUserInteraction={pauseVideoForInteraction}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
