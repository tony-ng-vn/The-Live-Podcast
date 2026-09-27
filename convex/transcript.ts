import { extractYouTubeId as extractSharedYouTubeId } from "../src/lib/youtube";

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface ChunkedTranscript {
  text: string;
  startTime: number;
  endTime: number;
}

export function extractYouTubeId(url: string): string | null {
  return extractSharedYouTubeId(url);
}

const CHUNK_DURATION_SECONDS = 5;

/**
 * Groups caption segments into fixed-duration chunks for storage and
 * time-windowed retrieval.
 *
 * A chunk's `startTime` is the first segment's offset and `endTime` is the
 * last segment's end, so chunks are contiguous and non-overlapping apart from
 * gaps in the source captions.
 */
export function chunkTranscript(
  segments: TranscriptSegment[],
  chunkDurationSeconds: number = CHUNK_DURATION_SECONDS,
): ChunkedTranscript[] {
  if (segments.length === 0) return [];

  const chunks: ChunkedTranscript[] = [];
  let currentChunk: TranscriptSegment[] = [];
  let chunkStart = segments[0].offset;

  for (const segment of segments) {
    currentChunk.push(segment);

    const chunkEnd = segment.offset + segment.duration;
    if (chunkEnd - chunkStart >= chunkDurationSeconds) {
      chunks.push({
        text: currentChunk.map((s) => s.text).join(" "),
        startTime: chunkStart,
        endTime: chunkEnd,
      });
      currentChunk = [];
      chunkStart = chunkEnd;
    }
  }

  if (currentChunk.length > 0) {
    const last = currentChunk[currentChunk.length - 1];
    chunks.push({
      text: currentChunk.map((s) => s.text).join(" "),
      startTime: chunkStart,
      endTime: last.offset + last.duration,
    });
  }

  return chunks;
}
