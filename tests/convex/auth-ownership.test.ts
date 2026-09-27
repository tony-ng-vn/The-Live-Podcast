import { describe, expect, it, vi } from "vitest";
import { listConversationMessages, appendAssistantMessage, rollbackFailedQuestion, startConversation } from "../../convex/chat";
import { getExistingEpisodeByYoutubeId, listEpisodes } from "../../convex/episodes";

function handlerOf(value: unknown): (context: unknown, args: unknown) => Promise<unknown> {
  return (value as { _handler: (context: unknown, args: unknown) => Promise<unknown> })._handler;
}

describe("Convex ownership checks", () => {
  it("rejects another user's library even when their user ID is supplied", async () => {
    const dbQuery = vi.fn();
    await expect(handlerOf(listEpisodes)({
      auth: { getUserIdentity: async () => ({ subject: "user_a" }) },
      db: { query: dbQuery },
    }, { userId: "user_b" })).rejects.toThrow("Unauthorized");
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it("does not reveal whether another user saved a video", async () => {
    const dbQuery = vi.fn();
    await expect(handlerOf(getExistingEpisodeByYoutubeId)({
      auth: { getUserIdentity: async () => ({ subject: "user_a" }) },
      db: { query: dbQuery },
    }, { userId: "user_b", youtubeId: "video_1" })).rejects.toThrow("Unauthorized");
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it("does not reveal messages from another user's conversation", async () => {
    const dbQuery = vi.fn();
    await expect(handlerOf(listConversationMessages)({
      auth: { getUserIdentity: async () => ({ subject: "user_a" }) },
      db: { get: async () => ({ userId: "user_b" }), query: dbQuery },
    }, { conversationId: "conversation_b" })).rejects.toThrow("Unauthorized");
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it("does not append an assistant message to another user's conversation", async () => {
    const insert = vi.fn();
    await expect(handlerOf(appendAssistantMessage)({
      auth: { getUserIdentity: async () => ({ subject: "user_a" }) },
      db: { get: async () => ({ userId: "user_b" }), insert },
    }, { conversationId: "conversation_b", content: "secret" })).rejects.toThrow("Unauthorized");
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not remove another user's failed question", async () => {
    const dbGet = vi.fn(async () => ({ userId: "user_b" }));
    const dbDelete = vi.fn();
    await expect(handlerOf(rollbackFailedQuestion)({
      auth: { getUserIdentity: async () => ({ subject: "user_a" }) },
      db: { get: dbGet, delete: dbDelete },
    }, { conversationId: "conversation_b", messageId: "question_b" })).rejects.toThrow("Unauthorized");
    expect(dbGet).toHaveBeenCalledTimes(1);
    expect(dbDelete).not.toHaveBeenCalled();
  });

  it("rejects a caller who has no verified Clerk token before creating a conversation", async () => {
    const dbGet = vi.fn();
    await expect(handlerOf(startConversation)({
      auth: { getUserIdentity: async () => null },
      db: { get: dbGet },
    }, {
      userId: "user_a",
      episodeId: "episode_a",
      podcasterId: "podcaster_a",
      timestamp: 10,
      message: "Hello",
    })).rejects.toThrow("Unauthorized");
    expect(dbGet).not.toHaveBeenCalled();
  });
});
