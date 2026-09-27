"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import EpisodeCard from "@/components/EpisodeCard";
import { publicFailure, readApiError } from "@/lib/api-error";

interface Podcaster {
  name: string;
}

interface Episode {
  id: string;
  title: string;
  youtubeId: string;
  thumbnailUrl?: string | null;
  description?: string | null;
  podcaster: Podcaster;
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="aspect-video w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <div className="p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchEpisodes = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/episodes");
      if (!res.ok) {
        setLoadError(await readApiError(res, "LIBRARY_UNAVAILABLE"));
        return;
      }
      const data = (await res.json()) as Episode[];
      setEpisodes(data);
    } catch {
      setLoadError(publicFailure("LIBRARY_UNAVAILABLE").error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEpisodes();
  }, [fetchEpisodes]);

  // Group episodes by podcaster name
  const grouped = episodes.reduce<Record<string, Episode[]>>((acc, ep) => {
    const name = ep.podcaster.name;
    if (!acc[name]) {
      acc[name] = [];
    }
    acc[name].push(ep);
    return acc;
  }, {});

  const podcasterNames = Object.keys(grouped).sort();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Library
      </h1>

      {loading && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading && loadError && (
        <div className="mt-20 flex flex-col items-center text-center" role="alert">
          <p className="text-lg text-zinc-500 dark:text-zinc-400">{loadError}</p>
          <button
            type="button"
            onClick={() => void fetchEpisodes()}
            className="mt-6 rounded-full bg-zinc-900 px-8 py-3 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-50 dark:text-zinc-900"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !loadError && episodes.length === 0 && (
        <div className="mt-20 flex flex-col items-center text-center">
          <p className="text-lg text-zinc-500 dark:text-zinc-400">
            No videos yet
          </p>
          <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
            Add your first YouTube video to get started.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center rounded-full bg-zinc-900 px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add a Video
          </Link>
        </div>
      )}

      {!loading && !loadError &&
        episodes.length > 0 &&
        podcasterNames.map((name) => (
          <section key={name} className="mt-10">
            <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">
              {name}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[name].map((episode) => (
                <EpisodeCard key={episode.id} episode={episode} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
