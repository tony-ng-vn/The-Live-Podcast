import { describe, expect, it } from "vitest";
import { chunkTranscript } from "../../convex/transcript";

const seg = (text: string, offset: number, duration: number) => ({
  text,
  offset,
  duration,
});

describe("chunkTranscript", () => {
  it("returns an empty array for no segments", () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it("groups segments into fixed-duration chunks", () => {
    const segments = [
      seg("one", 0, 2),
      seg("two", 2, 2),
      seg("three", 4, 2),
      seg("four", 6, 2),
    ];

    const chunks = chunkTranscript(segments, 5);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toBe("one two three");
    expect(chunks[0].startTime).toBe(0);
    expect(chunks[0].endTime).toBe(6);
  });

  it("emits a trailing partial chunk rather than dropping content", () => {
    const segments = [seg("a", 0, 1), seg("b", 1, 1)];
    const chunks = chunkTranscript(segments, 5);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("a b");
    expect(chunks[0].endTime).toBe(2);
  });

  it("starts chunk boundaries at the previous chunk's end", () => {
    const segments = [
      seg("a", 0, 5),
      seg("b", 5, 5),
      seg("c", 10, 5),
    ];
    const chunks = chunkTranscript(segments, 5);

    expect(chunks.map((c) => c.startTime)).toEqual([0, 5, 10]);
    expect(chunks.map((c) => c.endTime)).toEqual([5, 10, 15]);
  });

  it("never loses or duplicates text", () => {
    const segments = Array.from({ length: 50 }, (_, i) =>
      seg(`w${i}`, i * 2, 2),
    );

    const chunks = chunkTranscript(segments, 7);
    const rejoined = chunks.map((c) => c.text).join(" ").split(" ");

    expect(rejoined).toEqual(segments.map((s) => s.text));
  });

  it("produces contiguous, non-decreasing chunks", () => {
    const segments = Array.from({ length: 200 }, (_, i) =>
      seg(`t${i}`, i * 1.5, 1.5),
    );

    const chunks = chunkTranscript(segments, 5);

    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].startTime).toBeGreaterThanOrEqual(chunks[i - 1].endTime);
    }
  });

  it("handles a single segment", () => {
    const chunks = chunkTranscript([seg("only", 12, 3)]);
    expect(chunks).toEqual([{ text: "only", startTime: 12, endTime: 15 }]);
  });
});
