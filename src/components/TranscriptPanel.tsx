"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TranscriptLine {
  startTime: number;
  endTime: number;
  text: string;
}

const PAGE_SIZE = 400;
/** Stop auto-fetching once this much of the episode is buffered. */
const MAX_BUFFER_SECONDS = 6 * 60 * 60;

export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const mm = mins.toString().padStart(2, "0");
  const ss = secs.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mins}:${ss}`;
}

interface TranscriptPanelProps {
  episodeId: string;
  currentTime: number;
  onSeek: (seconds: number) => void;
  disabled: boolean;
}

/**
 * Scrollable transcript with jump-to-time.
 *
 * Pages chunks in from the server on demand instead of shipping an entire
 * episode's transcript to the browser up front, and auto-loads the next page as
 * the viewer approaches the buffered edge.
 */
export default function TranscriptPanel({
  episodeId,
  currentTime,
  onSeek,
  disabled,
}: TranscriptPanelProps) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const cursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  // Identifies the episode a request was issued for. A response whose episode
  // no longer matches is discarded, so switching episodes mid-flight cannot
  // append the previous episode's lines or clobber the cursor.
  const requestEpisodeRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    requestEpisodeRef.current = episodeId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const query = new URLSearchParams({ num: String(PAGE_SIZE) });
    if (cursorRef.current) query.set("cursor", cursorRef.current);

    try {
      const res = await fetch(
        `/api/episodes/${episodeId}/transcript?${query.toString()}`,
        { signal: controller.signal },
      );

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Could not load the transcript.");
      }

      const result = (await res.json()) as {
        page: TranscriptLine[];
        isDone: boolean;
        continueCursor: string;
      };

      // Discard a response for an episode the viewer has already navigated off.
      if (requestEpisodeRef.current !== episodeId) return;

      setLines((prev) => [...prev, ...result.page]);
      cursorRef.current = result.continueCursor;
      setIsDone(result.isDone);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (requestEpisodeRef.current !== episodeId) return;
      setError(
        err instanceof Error ? err.message : "Could not load the transcript.",
      );
    } finally {
      if (requestEpisodeRef.current === episodeId) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [episodeId]);

  useEffect(() => {
    // Reset for the new episode, and drop any response still in flight for
    // the previous one.
    abortRef.current?.abort();
    inFlightRef.current = false;
    requestEpisodeRef.current = episodeId;
    cursorRef.current = null;
    setLines([]);
    setIsDone(false);
    setError(null);
    void loadMore();

    return () => {
      abortRef.current?.abort();
    };
  }, [episodeId, loadMore]);

  const lastLoadedEnd = lines.length > 0 ? lines[lines.length - 1].endTime : 0;

  // Prefetch ahead of the playhead so scrolling never stalls on a network call.
  useEffect(() => {
    if (isDone || loading) return;
    if (currentTime > lastLoadedEnd - 120 && lastLoadedEnd < MAX_BUFFER_SECONDS) {
      void loadMore();
    }
  }, [currentTime, lastLoadedEnd, isDone, loading, loadMore]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((line) => line.text.toLowerCase().includes(needle));
  }, [lines, query]);

  // Keep the line nearest the playhead in view while watching.
  useEffect(() => {
    if (query) return;
    const container = containerRef.current;
    if (!container) return;

    const index = filtered.findIndex(
      (line) => line.endTime > currentTime,
    );
    const target = filtered[index === -1 ? filtered.length - 1 : index];
    if (!target) return;

    const node = activeRef.current;
    if (node) {
      const nodeTop = node.offsetTop - container.offsetTop;
      const nodeBottom = nodeTop + node.offsetHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;

      if (nodeTop < viewTop || nodeBottom > viewBottom) {
        container.scrollTo({
          top: nodeTop - container.clientHeight / 3,
          behavior: "smooth",
        });
      }
    }
  }, [currentTime, filtered, query]);

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      aria-label="Transcript"
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Transcript
          </h2>
          <label htmlFor="transcript-search" className="sr-only">
            Search transcript
          </label>
          <input
            id="transcript-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-32 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && (
          <p className="px-2 py-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        {!error && filtered.length === 0 && !loading && (
          <p className="px-2 py-4 text-sm text-zinc-400 dark:text-zinc-500">
            {query ? "No matches." : "No transcript available."}
          </p>
        )}

        {filtered.map((line, index) => {
          const isActive = !query && line.endTime > currentTime && (index === 0 || filtered[index - 1].endTime <= currentTime);
          return (
            <button
              key={`${line.startTime}-${index}`}
              type="button"
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek(line.startTime)}
              disabled={disabled}
              aria-current={isActive ? "true" : undefined}
              className={`flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default ${
                isActive
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
              }`}
            >
              <span className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                {formatClock(line.startTime)}
              </span>
              <span className="leading-relaxed">{line.text}</span>
            </button>
          );
        })}

        {loading && (
          <p className="px-2 py-3 text-xs text-zinc-400 dark:text-zinc-500">
            Loading transcript…
          </p>
        )}

        {!isDone && !loading && lines.length > 0 && (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="mt-2 w-full rounded-md px-2 py-2 text-xs text-zinc-500 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:hover:bg-zinc-800"
          >
            Load more
          </button>
        )}
      </div>
    </section>
  );
}
