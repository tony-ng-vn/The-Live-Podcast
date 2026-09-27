import { describe, expect, it } from "vitest";
import {
  buildMvpSystemPrompt,
  formatTimestamp,
  trimHistory,
} from "@/lib/chat/system-prompt";

describe("formatTimestamp", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(9)).toBe("0:09");
    expect(formatTimestamp(75)).toBe("1:15");
    expect(formatTimestamp(3600)).toBe("60:00");
  });

  it("clamps invalid input rather than emitting NaN", () => {
    expect(formatTimestamp(-5)).toBe("0:00");
    expect(formatTimestamp(Number.NaN)).toBe("0:00");
  });
});

describe("buildMvpSystemPrompt", () => {
  const chunks = [
    { text: "Welcome to the show.", startTime: 0, endTime: 10 },
    { text: "Today we discuss pricing.", startTime: 10, endTime: 25 },
    { text: "Here is the part you paused on.", startTime: 25, endTime: 40 },
  ];

  it("includes the video title and the transcript", () => {
    const prompt = buildMvpSystemPrompt({
      videoTitle: "Pricing Deep Dive",
      currentTimestamp: 40,
      chunks,
    });

    expect(prompt).toContain("Pricing Deep Dive");
    expect(prompt).toContain("Today we discuss pricing.");
  });

  it("includes the pause timestamp", () => {
    const prompt = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 65,
      chunks,
    });
    expect(prompt).toContain("1:05");
  });

  it("handles an empty transcript gracefully", () => {
    const prompt = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 10,
      chunks: [],
    });
    expect(prompt).toContain("Episode");
    expect(prompt).toContain("0:10");
  });

  it("includes behavioural instructions", () => {
    const prompt = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 40,
      chunks,
    });
    expect(prompt).toMatch(/conversationally/i);
  });

  it("anchors on the final minutes of the transcript", () => {
    const prompt = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 40,
      chunks,
    });
    expect(prompt).toContain("Here is the part you paused on.");
  });

  /**
   * Prompt caching only pays off if the byte prefix is identical between
   * messages sent at the same playback position. The old layout opened with the
   * timestamp, which changed on every turn and invalidated the entire cache.
   */
  it("keeps the transcript before the volatile timestamp so the prefix is cacheable", () => {
    const prompt = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 40,
      chunks,
    });

    const transcriptIndex = prompt.indexOf("Welcome to the show.");
    const timestampIndex = prompt.indexOf("0:40");

    expect(transcriptIndex).toBeGreaterThanOrEqual(0);
    expect(timestampIndex).toBeGreaterThanOrEqual(0);
    expect(transcriptIndex).toBeLessThan(timestampIndex);
  });

  it("produces a stable prefix across turns at the same position", () => {
    const first = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 40,
      chunks,
    });
    const second = buildMvpSystemPrompt({
      videoTitle: "Episode",
      currentTimestamp: 40,
      chunks,
    });

    // Identical inputs must produce an identical prompt; the instability came
    // from volatile content being placed ahead of the stable transcript.
    expect(first).toBe(second);
    expect(first.startsWith("You are helping a viewer")).toBe(true);
  });
});

describe("trimHistory", () => {
  const turn = (role: "user" | "assistant", size: number) => ({
    role,
    content: "x".repeat(size),
  });

  it("returns history untouched when it fits the budget", () => {
    const history = [turn("user", 10), turn("assistant", 10)];
    expect(trimHistory(history, 1_000)).toEqual(history);
  });

  it("returns an empty array for empty history", () => {
    expect(trimHistory([], 100)).toEqual([]);
  });

  it("keeps the most recent turns when over budget", () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", 100),
    );

    const trimmed = trimHistory(history, 500, 4);

    expect(trimmed.length).toBeLessThan(history.length);
    // The retained tail must be the newest turns.
    expect(trimmed[trimmed.length - 1].content).toBe(
      history[history.length - 1].content,
    );
  });

  it("never starts the retained history with an assistant turn", () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", 500),
    );

    const trimmed = trimHistory(history, 200, 3);

    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed[0].role).toBe("user");
  });

  it("respects the character budget", () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", 1_000),
    );

    const budget = 5_000;
    const trimmed = trimHistory(history, budget, 4);
    const total = trimmed.reduce((sum, m) => sum + m.content.length, 0);

    expect(total).toBeLessThanOrEqual(budget);
  });
});
