import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { ForbiddenError, requireUserId } from "./auth";
import {
  FORBIDDEN_CONVERSATION_MESSAGE,
  FORBIDDEN_EPISODE_MESSAGE,
} from "../src/lib/convex/auth-messages";
import {
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_MESSAGE_LENGTH,
} from "../src/lib/chat/limits";

export const startConversation = mutation({
  args: {
    episodeId: v.id("episodes"),
    podcasterId: v.id("podcasters"),
    timestamp: v.number(),
    message: v.string(),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const trimmedMessage = args.message.trim();
    if (!trimmedMessage) {
      throw new ConvexError("Message cannot be empty or whitespace-only");
    }
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError(
        `Message is too long (${trimmedMessage.length} characters, max ${MAX_MESSAGE_LENGTH})`,
      );
    }
    if (!Number.isFinite(args.timestamp) || args.timestamp < 0) {
      throw new ConvexError("timestamp must be a non-negative number");
    }

    const episode = await ctx.db.get(args.episodeId);
    if (!episode) {
      throw new ConvexError("Episode not found");
    }
    if (episode.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_EPISODE_MESSAGE);
    }

    const podcaster = await ctx.db.get(args.podcasterId);
    if (!podcaster) {
      throw new ConvexError("Podcaster not found");
    }
    if (episode.podcasterId !== args.podcasterId) {
      throw new ConvexError("Episode does not belong to the specified podcaster");
    }

    let activeConversationId = args.conversationId;

    if (activeConversationId) {
      const existing = await ctx.db.get(activeConversationId);
      if (!existing) {
        throw new ConvexError("Conversation not found");
      }
      if (existing.userId !== userId) {
        throw new ForbiddenError(FORBIDDEN_CONVERSATION_MESSAGE);
      }
      if (existing.episodeId !== args.episodeId) {
        throw new ConvexError("Conversation belongs to a different episode");
      }

      await ctx.db.patch(activeConversationId, {
        timestampInEpisode: args.timestamp,
        updatedAt: Date.now(),
      });
    } else {
      const now = Date.now();
      activeConversationId = await ctx.db.insert("conversations", {
        userId,
        podcasterId: args.podcasterId,
        episodeId: args.episodeId,
        timestampInEpisode: args.timestamp,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("conversationMessages", {
      conversationId: activeConversationId,
      role: "user",
      content: trimmedMessage,
      createdAt: Date.now(),
    });

    return { conversationId: activeConversationId };
  },
});

/**
 * Prior turns for the LLM prompt, oldest first.
 *
 * Ownership is checked here rather than trusting the caller: this was
 * previously a public query that returned any conversation by id.
 */
export const listConversationMessages = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError("Conversation not found");
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_CONVERSATION_MESSAGE);
    }

    const messages = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  },
});

export const appendAssistantMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError("Conversation not found");
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_CONVERSATION_MESSAGE);
    }
    if (args.content.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
      throw new ConvexError("Assistant response is unexpectedly long");
    }

    await ctx.db.insert("conversationMessages", {
      conversationId: args.conversationId,
      role: "assistant",
      content: args.content,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.conversationId, { updatedAt: Date.now() });

    return { ok: true };
  },
});

export const endConversation = action({
  args: {
    conversationId: v.id("conversations"),
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const conversation = await ctx.runQuery(internal.chat.getConversationById, {
      conversationId: args.conversationId,
    });

    if (!conversation) {
      throw new ConvexError("Conversation not found");
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_CONVERSATION_MESSAGE);
    }
    if (conversation.podcasterId !== args.podcasterId) {
      throw new ConvexError("Conversation podcaster mismatch");
    }

    const messageCount = await ctx.runQuery(
      internal.chat.getConversationMessageCount,
      { conversationId: args.conversationId },
    );

    if (messageCount === 0) {
      return { message: "No messages in conversation, nothing to persist" };
    }

    await ctx.runAction(
      internal.profiles.updateUserPodcasterMemoryFromConversation,
      {
        userId,
        podcasterId: args.podcasterId,
        conversationId: args.conversationId,
      },
    );

    return { message: "Memory updated successfully" };
  },
});

export const getConversationById = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return null;
    }

    return {
      id: conversation._id,
      userId: conversation.userId,
      podcasterId: conversation.podcasterId,
      episodeId: conversation.episodeId,
    };
  },
});

export const getConversationMessageCount = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    return messages.length;
  },
});
