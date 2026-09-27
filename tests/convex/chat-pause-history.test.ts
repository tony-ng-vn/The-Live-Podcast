import { describe, expect, it, vi } from "vitest";
import { rollbackFailedQuestion, selectConversationMessagesUpToTimestamp, startConversation } from "../../convex/chat";

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

  it("removes only the latest pending question after a provider failure", async () => {
    const dbDelete = vi.fn();
    const question = {
      _id: "question_1",
      conversationId: "conversation_1",
      role: "user",
      createdAt: Date.now(),
    };
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      db: {
        get: vi.fn(async (id: string) => id === "conversation_1" ? { userId: "user_1" } : question),
        query: vi.fn(() => ({
          withIndex: () => ({ order: () => ({ first: async () => question }) }),
        })),
        delete: dbDelete,
      },
    };
    const handler = (rollbackFailedQuestion as unknown as {
      _handler: (context: unknown, args: unknown) => Promise<unknown>;
    })._handler;

    await handler(ctx, { conversationId: "conversation_1", messageId: "question_1" });
    expect(dbDelete).toHaveBeenCalledWith("question_1");
    expect(dbDelete).toHaveBeenCalledTimes(1);
  });
  it.each(["answered", "expired", "wrong conversation", "assistant message"])("keeps a question that is %s", async (kind) => {
    const question = {
      _id: "question_1", conversationId: kind === "wrong conversation" ? "other" : "conversation_1",
      role: kind === "assistant message" ? "assistant" : "user",
      createdAt: Date.now() - (kind === "expired" ? 11 * 60 * 1000 : 0),
    };
    const dbDelete = vi.fn();
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      db: {
        get: async (id: string) => id === "conversation_1" ? { userId: "user_1" } : question,
        query: () => ({ withIndex: () => ({ order: () => ({ first: async () =>
          kind === "answered" ? { _id: "answer_1" } : question,
        }) }) }),
        delete: dbDelete,
      },
    };
    const handler = (rollbackFailedQuestion as unknown as {
      _handler: (context: unknown, args: unknown) => Promise<unknown>;
    })._handler;
    await expect(handler(ctx, { conversationId: "conversation_1", messageId: "question_1" })).rejects.toThrow();
    expect(dbDelete).not.toHaveBeenCalled();
  });

});
