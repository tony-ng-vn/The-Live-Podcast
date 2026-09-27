import { describe, expect, it } from "vitest";
import { selectConversationMessagesUpToTimestamp } from "../../convex/chat";

describe("chat pause history", () => {
  it("keeps earlier messages and excludes later answers after a rewind", () => {
    expect(selectConversationMessagesUpToTimestamp([
      { role: "user", content: "At 20 seconds", timestampInEpisode: 20 },
      { role: "assistant", content: "Earlier answer", timestampInEpisode: 20 },
      { role: "user", content: "At 90 seconds", timestampInEpisode: 90 },
      { role: "assistant", content: "Later answer", timestampInEpisode: 90 },
      { role: "user", content: "Old untagged question" },
    ], 30)).toEqual([
      { role: "user", content: "At 20 seconds" },
      { role: "assistant", content: "Earlier answer" },
    ]);
  });

  it("includes messages at the exact pause point", () => {
    expect(selectConversationMessagesUpToTimestamp([
      { role: "user", content: "At 30 seconds", timestampInEpisode: 30 },
    ], 30)).toEqual([{ role: "user", content: "At 30 seconds" }]);
  });

  it("accepts calls from the current web deployment during rollout", () => {
    expect(selectConversationMessagesUpToTimestamp([
      { role: "user", content: "Existing message" },
    ], undefined)).toEqual([{ role: "user", content: "Existing message" }]);
  });
});
