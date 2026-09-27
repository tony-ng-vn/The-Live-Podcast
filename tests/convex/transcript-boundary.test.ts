import { describe, expect, it } from "vitest";
import {
  chunkTranscript,
  selectTranscriptUpToTimestamp,
} from "../../convex/transcript";

describe("transcript pause boundary", () => {
  const chunks = chunkTranscript([
    { text: "Already heard.", offset: 0, duration: 2 },
    { text: "Spoken after pause.", offset: 2, duration: 4 },
    { text: "Much later.", offset: 6, duration: 2 },
  ]);

  it("keeps only complete captions at the pause point within a chunk", () => {
    expect(selectTranscriptUpToTimestamp(chunks, 3)).toEqual([
      { text: "Already heard.", startTime: 0, endTime: 2 },
    ]);
  });

  it("includes a caption at its exact end and adds later captions only after they end", () => {
    expect(selectTranscriptUpToTimestamp(chunks, 6)).toEqual([
      { text: "Already heard. Spoken after pause.", startTime: 0, endTime: 6 },
    ]);
    expect(selectTranscriptUpToTimestamp(chunks, 8)).toEqual([
      { text: "Already heard. Spoken after pause.", startTime: 0, endTime: 6 },
      { text: "Much later.", startTime: 6, endTime: 8 },
    ]);
  });

  it("holds a caption with no final timing until the player reaches the video end", () => {
    const startOnly = chunkTranscript([
      { text: "Earlier caption.", offset: 0, duration: 8 },
      { text: "Final caption.", offset: 8, duration: 0, requiresVideoEnd: true },
    ]);
    expect(selectTranscriptUpToTimestamp(startOnly, 12)).toEqual([
      { text: "Earlier caption.", startTime: 0, endTime: 8 },
    ]);
    expect(selectTranscriptUpToTimestamp(startOnly, 12, 20)).toEqual([
      { text: "Earlier caption.", startTime: 0, endTime: 8 },
    ]);
    expect(selectTranscriptUpToTimestamp(startOnly, 20, 20)).toEqual([
      { text: "Earlier caption.", startTime: 0, endTime: 8 },
      { text: "Final caption.", startTime: 8, endTime: 20 },
    ]);
    expect(selectTranscriptUpToTimestamp(startOnly, 20, Number.NaN)).toHaveLength(1);
  });

  it("does not reveal a legacy chunk that overlaps the pause point", () => {
    expect(selectTranscriptUpToTimestamp([
      { text: "Old unsplit text", startTime: 0, endTime: 6 },
    ], 3)).toEqual([]);
  });
});
