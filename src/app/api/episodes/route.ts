import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getConvexClient,
  api,
  isConvexConfigurationError,
} from "@/lib/convex/client";
import { extractYouTubeId } from "@/lib/youtube";
import {
  fetchTranscriptSegments,
  TranscriptServiceError,
} from "@/lib/transcript-service";

interface YouTubeOEmbedResponse {
  title: string;
  author_name: string;
  author_url: string;
  thumbnail_url?: string;
}

export const MAX_EPISODE_URL_LENGTH = 500;
const TRANSCRIPT_TIMEOUT_MS = 30_000;
const INGEST_TIMEOUT_MS = 45_000;
const METADATA_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 5_000;

export class HttpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpTimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new HttpTimeoutError(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Fetches title/channel metadata from YouTube's public oEmbed endpoint.
 *
 * Never throws: metadata is a nice-to-have, and a failure here must not block
 * ingestion. The caller falls back to derived placeholders.
 */
async function fetchYouTubeMetadata(
  videoId: string,
): Promise<YouTubeOEmbedResponse | null> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oEmbedUrl =
    `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

  try {
    return await withTimeout(
      fetch(oEmbedUrl, { headers: { Accept: "application/json" } }).then(
        async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as YouTubeOEmbedResponse;
        },
      ),
      METADATA_TIMEOUT_MS,
      "oEmbed metadata lookup timed out",
    );
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
    const authResult = await withTimeout(
      auth(),
      AUTH_TIMEOUT_MS,
      "Timed out while checking authentication",
    );
    userId = authResult.userId;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication check failed";
    return NextResponse.json({ error: message }, { status: 503 });
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
      { status: 400 },
    );
  }

  if (!body || typeof body.url !== "string" || body.url.trim() === "") {
    return NextResponse.json(
      { error: "Missing or empty 'url' field" },
      { status: 400 },
    );
  }

  const url = body.url.trim();
  if (url.length > MAX_EPISODE_URL_LENGTH) {
    return NextResponse.json(
      { error: `URL must be under ${MAX_EPISODE_URL_LENGTH} characters` },
      { status: 400 },
    );
  }

  // Validate locally before spending a transcript fetch or a Convex round trip.
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    return NextResponse.json(
      {
        error:
          "Invalid YouTube URL. Supported formats: youtube.com/watch, youtu.be, youtube.com/embed, youtube.com/shorts, or a raw video ID",
      },
      { status: 400 },
    );
  }

  // Metadata and transcript are independent — fetch them concurrently.
  const metadataPromise = fetchYouTubeMetadata(videoId);

  let segments: Awaited<ReturnType<typeof fetchTranscriptSegments>>;
  try {
    segments = await fetchTranscriptSegments(videoId, TRANSCRIPT_TIMEOUT_MS);
  } catch (transcriptError) {
    if (transcriptError instanceof TranscriptServiceError) {
      return NextResponse.json(
        { error: transcriptError.message },
        { status: transcriptError.status },
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch transcript" },
      { status: 502 },
    );
  }

  const metadata = await metadataPromise;

  try {
    const convex = getConvexClient();

    // Best-effort: a missing profile row should not fail ingestion.
    await withTimeout(
      convex.mutation(api.users.ensureUser, {
        clerkUserId: userId,
        email: undefined,
        name: undefined,
        imageUrl: undefined,
      }),
      10_000,
      "Timed out while ensuring user profile",
    ).catch(() => undefined);

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
      INGEST_TIMEOUT_MS,
      "Ingest timed out while saving episode to backend",
    );

    return NextResponse.json(episode, { status: 201 });
  } catch (error) {
    if (isConvexConfigurationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const message =
      error instanceof Error ? error.message : "Failed to ingest episode";

    if (message.includes("already been ingested")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("Invalid YouTube URL")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (
      message.includes("No transcript") ||
      message.includes("Transcript") ||
      message.includes("captions")
    ) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const convex = getConvexClient();
    const episodes = await convex.query(api.episodes.listEpisodes, { userId });

    return NextResponse.json(episodes, { status: 200 });
  } catch (error) {
    if (isConvexConfigurationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const message =
      error instanceof Error ? error.message : "Failed to load episodes";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
