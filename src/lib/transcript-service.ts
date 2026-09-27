import { extractYouTubeId } from "@/lib/youtube";

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

interface TranscriptServiceResponse {
  videoId: string;
  segments: Array<{ text: string; start: number; duration: number }>;
}

const DEFAULT_SERVICE_URL = "http://127.0.0.1:8765";
const DEFAULT_TIMEOUT_MS = 30_000;

export class TranscriptServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscriptServiceError";
    this.status = status;
  }
}

export function getTranscriptServiceUrl(): string {
  return process.env.TRANSCRIPT_SERVICE_URL ?? DEFAULT_SERVICE_URL;
}

/**
 * Fetches caption segments for a YouTube video from the local Python sidecar.
 *
 * The sidecar must be running (`npm run transcript:dev`); it cannot be reached
 * from a Convex action runtime, so this is only called from Next.js route
 * handlers.
 */
export async function fetchTranscriptSegments(
  videoIdOrUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TranscriptSegment[]> {
  const videoId = extractYouTubeId(videoIdOrUrl);
  if (!videoId) {
    throw new TranscriptServiceError(
      `Could not extract YouTube video ID from: ${videoIdOrUrl}`,
      400,
    );
  }

  const serviceUrl = getTranscriptServiceUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/transcript/${videoId}`, {
      signal: controller.signal,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new TranscriptServiceError(
      isTimeout
        ? `Transcript service timed out after ${Math.round(timeoutMs / 1000)}s for video ${videoId}. YouTube may be slow or the service is overloaded.`
        : `Transcript service is unreachable at ${serviceUrl}. Start it with: npm run transcript:dev`,
      isTimeout ? 504 : 502,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the status-code message when the body is not JSON.
    }
    // 404 from the sidecar means "no captions" — not a server fault.
    const status = response.status === 404 ? 422 : 502;
    throw new TranscriptServiceError(
      `Transcript service error for video ${videoId}: ${detail}`,
      status,
    );
  }

  const data = (await response.json()) as TranscriptServiceResponse;
  if (!data.segments || data.segments.length === 0) {
    throw new TranscriptServiceError(
      `No transcript segments returned for video (${videoId})`,
      422,
    );
  }

  return data.segments.map((s) => ({
    text: s.text,
    offset: s.start,
    duration: s.duration,
  }));
}
