import { describe, expect, it, vi } from "vitest";
import { selectConversationMessagesUpToTimestamp, startConversation } from "../../convex/chat";

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

  it("rejects a conversation from another episode before adding the question", async () => {
    const insert = vi.fn();
    const records: Record<string, Record<string, string>> = {
      episode_1: { podcasterId: "podcaster_1", userId: "user_1" },
      podcaster_1: {},
      conversation_1: {
        userId: "user_1",
        episodeId: "episode_2",
        podcasterId: "podcaster_1",
      },
    };
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      db: { get: vi.fn(async (id: string) => records[id]), insert },
    };

    const handler = (startConversation as unknown as {
      _handler: (context: unknown, args: unknown) => Promise<unknown>;
    })._handler;

    await expect(handler(ctx, {
      userId: "user_1",
      episodeId: "episode_1",
      podcasterId: "podcaster_1",
      conversationId: "conversation_1",
      timestamp: 30,
      message: "What did they say?",
    })).rejects.toThrow("Conversation episode mismatch");
    expect(insert).not.toHaveBeenCalled();
  });
});
