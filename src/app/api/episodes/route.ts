import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getConvexClient,
  api,
} from "@/lib/convex/client";
import { extractYouTubeId } from "@/lib/youtube";
import { FRIENDLY_SERVER_ERROR } from "@/lib/api-error";
import { recordServerError } from "@/lib/server-error";

class TranscriptServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function serviceFailure(source: string, error: unknown): Promise<Response> {
  const errorId = await recordServerError(source, error);
  return NextResponse.json(
    { error: FRIENDLY_SERVER_ERROR, errorId },
    { status: 503 },
  );
}

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

interface TranscriptServiceResponse {
  videoId: string;
  segments: TranscriptSegment[];
}

interface SerpApiTranscriptResponse {
  search_metadata?: { status?: string };
  error?: string;
  transcript?: Array<{ start_ms?: number; end_ms?: number; snippet?: string }>;
}

interface YouTubeOEmbedResponse {
  title: string;
  author_name: string;
  author_url: string;
  thumbnail_url?: string;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchTranscriptSegments(
  videoId: string,
): Promise<Array<{ text: string; offset: number; duration: number }>> {
  if (process.env.TRANSCRIPT_PROVIDER === "serpapi") {
    return fetchSerpApiTranscriptSegments(videoId);
  }

  const serviceUrl =
    process.env.TRANSCRIPT_SERVICE_URL ?? "http://127.0.0.1:8765";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  const serviceToken = process.env.TRANSCRIPT_SERVICE_TOKEN;

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/transcript/${videoId}`, {
      signal: controller.signal,
      headers: serviceToken ? { "X-Transcript-Token": serviceToken } : undefined,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new TranscriptServiceError(
      isTimeout
        ? `Transcript service timed out for video ${videoId}`
        : `Transcript service is unreachable at ${serviceUrl}. Start it with: npm run transcript:dev`,
      503,
    );
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new TranscriptServiceError(
      `Transcript service error for video ${videoId}: ${detail}`,
      response.status === 404 ? 422 : 503,
    );
  }

  const data = (await response.json()) as TranscriptServiceResponse;
  if (!data.segments || data.segments.length === 0) {
    throw new TranscriptServiceError(`No transcript segments returned for video (${videoId})`, 422);
  }

  return data.segments.map((s) => ({
    text: s.text,
    offset: s.start,
    duration: s.duration,
  }));
}

async function fetchSerpApiTranscriptSegments(
  videoId: string,
): Promise<Array<{ text: string; offset: number; duration: number }>> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new TranscriptServiceError("SerpApi transcript key is not configured", 503);
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "youtube_video_transcript");
  url.searchParams.set("v", videoId);
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    throw new TranscriptServiceError(
      timeout ? `SerpApi transcript request timed out for ${videoId}` : `SerpApi transcript request failed for ${videoId}`,
      503,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new TranscriptServiceError(`SerpApi transcript request returned HTTP ${response.status} for ${videoId}`, 503);
  }

  const data = (await response.json()) as SerpApiTranscriptResponse;
  if (data.error || data.search_metadata?.status !== "Success") {
    throw new TranscriptServiceError(`SerpApi transcript error for ${videoId}: ${data.error ?? data.search_metadata?.status ?? "unknown status"}`, 503);
  }
  if (!Array.isArray(data.transcript) || data.transcript.length === 0) {
    throw new TranscriptServiceError(`No transcript segments returned for video (${videoId})`, 422);
  }

  return data.transcript.map((segment) => {
    const { start_ms: start, end_ms: end, snippet } = segment;
    if (typeof start !== "number" || typeof end !== "number" ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
        typeof snippet !== "string" || !snippet.trim()) {
      throw new TranscriptServiceError(`Invalid SerpApi caption timing for video ${videoId}`, 503);
    }
    return { text: snippet, offset: start / 1000, duration: (end - start) / 1000 };
  });
}

async function fetchYouTubeMetadata(videoId: string): Promise<YouTubeOEmbedResponse | null> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oEmbedUrl =
    `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

  try {
    const response = await fetch(oEmbedUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as YouTubeOEmbedResponse;
  } catch {
    return null;
  }
}

interface PostRequestBody {
  url?: string;
}

export async function POST(request: Request): Promise<Response> {
  let userId: string | null;
  try {
    ({ userId } = await withTimeout(
      auth(),
      5_000,
      "Timed out while checking authentication",
    ));
  } catch (error) {
    return serviceFailure("episodes.auth", error);
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostRequestBody;
  try {
    body = (await request.json()) as PostRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  // Validate body and url field
  if (!body || typeof body.url !== "string" || body.url.trim() === "") {
    return NextResponse.json(
      { error: "Missing or empty 'url' field" },
      { status: 400 }
    );
  }

  const url = body.url.trim();

  // Extract video ID early for a fast local validation before hitting Convex.
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: "Invalid YouTube URL. Supported formats: youtube.com/watch, youtu.be, youtube.com/embed, youtube.com/shorts" },
      { status: 400 },
    );
  }

  // Fetch before Convex ingestion so the same timed segments work locally and in production.
  let segments: Array<{ text: string; offset: number; duration: number }>;
  const metadata = await fetchYouTubeMetadata(videoId);
  try {
    segments = await fetchTranscriptSegments(videoId);
  } catch (transcriptError) {
    const errorId = await recordServerError("episodes.transcript", transcriptError);
    if (transcriptError instanceof TranscriptServiceError && transcriptError.status === 422) {
      return NextResponse.json(
        { error: "This video does not have captions I can read yet.", errorId },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: FRIENDLY_SERVER_ERROR, errorId }, { status: 503 });
  }

  try {
    const convex = getConvexClient();
    await withTimeout(
      convex.mutation(api.users.ensureUser, {
        clerkUserId: userId,
        email: undefined,
        name: undefined,
        imageUrl: undefined,
      }),
      10_000,
      "Timed out while ensuring user profile",
    );

    const episode = await withTimeout(
      convex.action(api.episodes.ingestEpisode, {
        userId,
        url,
        podcasterName: metadata?.author_name ?? `Podcaster (${videoId})`,
        podcasterChannelUrl:
          metadata?.author_url ??
          `https://www.youtube.com/channel/placeholder-${videoId}`,
        episodeTitle: metadata?.title ?? `Episode ${videoId}`,
        thumbnailUrl: metadata?.thumbnail_url,
        segments,
      }),
      45_000,
      "Ingest timed out while saving episode to backend",
    );
    return NextResponse.json(episode, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to ingest episode";

    if (message.includes("already been ingested")) {
      return NextResponse.json({ error: "This episode is already in your Library." }, { status: 409 });
    }
    if (message.includes("Invalid YouTube URL")) {
      return NextResponse.json({ error: "Please enter a valid YouTube URL." }, { status: 400 });
    }
    if (
      message.includes("No transcript") ||
      message.includes("Transcript") ||
      message.includes("captions")
    ) {
      const errorId = await recordServerError("episodes.ingest", error);
      return NextResponse.json(
        { error: "This video does not have captions I can read yet.", errorId },
        { status: 422 },
      );
    }

    return serviceFailure("episodes.ingest", error);
  }
}

export async function GET(): Promise<Response> {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    return serviceFailure("episodes.auth", error);
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const convex = getConvexClient();
    const episodes = await convex.query(api.episodes.listEpisodes, { userId });

    return NextResponse.json(episodes, { status: 200 });
  } catch (error) {
    return serviceFailure("episodes.list", error);
  }
}
