import type { TranscriptSegment } from "../../convex/transcript";

export interface Caption {
  start_ms?: number;
  end_ms?: number;
  snippet?: string;
}

export function normalizeCaptions(captions: Caption[]): TranscriptSegment[] {
  return captions.map((caption, index) => {
    const start = caption.start_ms;
    const nextStart = captions[index + 1]?.start_ms;
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0 ||
        typeof caption.snippet !== "string" || !caption.snippet.trim() ||
        (index > 0 && start <= captions[index - 1].start_ms!)) {
      throw Object.assign(new Error("Caption text or start time is invalid"), { code: "TRANSCRIPT_TIMING_UNAVAILABLE" });
    }

    // Start-only transcripts give cue boundaries, not exact completion times.
    const end = caption.end_ms ?? nextStart;
    if (end === undefined && caption.end_ms === undefined && index === captions.length - 1) {
      return { text: caption.snippet, offset: start / 1000, duration: 0, requiresVideoEnd: true };
    }
    if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
      throw Object.assign(new Error("Caption end time is invalid"), { code: "TRANSCRIPT_TIMING_UNAVAILABLE" });
    }
    return { text: caption.snippet, offset: start / 1000, duration: (end - start) / 1000 };
  });
}
