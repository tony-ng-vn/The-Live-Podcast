import { describe, expect, it } from "vitest";
import { normalizeCaptions } from "../../src/lib/transcript-captions";
import { chunkTranscript, selectTranscriptUpToTimestamp } from "../../convex/transcript";

describe("start-only captions", () => {
  it("holds the current cue until the next cue boundary", () => {
    const chunks = chunkTranscript(normalizeCaptions([
      { start_ms: 0, snippet: "First cue" },
      { start_ms: 8000, snippet: "Second cue" },
      { start_ms: 16000, snippet: "Final cue" },
    ]));
    expect(selectTranscriptUpToTimestamp(chunks, 7.999)).toEqual([]);
    expect(selectTranscriptUpToTimestamp(chunks, 8)).toEqual([
      { text: "First cue", startTime: 0, endTime: 8 },
    ]);
    expect(selectTranscriptUpToTimestamp(chunks, 100)).toHaveLength(2);
  });

  it.each([
    [{ start_ms: -1, snippet: "Bad start" }],
    [{ start_ms: 0, end_ms: 0, snippet: "Bad end" }],
    [{ start_ms: 8, snippet: "First" }, { start_ms: 4, snippet: "Out of order" }],
    [{ start_ms: 0, snippet: " " }],
  ])("rejects malformed timing or text", (...captions) => {
    expect(() => normalizeCaptions(captions)).toThrow();
  });
});
