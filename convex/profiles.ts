import { v } from "convex/values";
import { chatWithLLM } from "./llm";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { ForbiddenError, requireUserId } from "./auth";
import { FORBIDDEN_PODCASTER_MESSAGE } from "../src/lib/convex/auth-messages";

const MAX_PROFILE_SOURCE_EPISODES = 5;
/**
 * Chunks sampled per episode. Five episodes x a 2-hour episode (~1440 chunks)
 * is ~7,200 documents, comfortably inside Convex's per-transaction read limit.
 */
const PROFILE_SAMPLE_TARGET = 36;

export const getPodcasterById = query({
  args: {
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);

    const podcaster = await ctx.db.get(args.podcasterId);
    if (!podcaster) {
      return null;
    }

    return { id: podcaster._id, name: podcaster.name };
  },
});

/**
 * Builds a personality profile for a podcaster.
 *
 * This invokes a paid LLM, so it is authenticated and the podcaster must have
 * at least one episode belonging to the caller. It used to be an unauthenticated
 * public action.
 */
export const rebuildPodcasterProfile: ReturnType<typeof action> = action({
  args: {
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const owned = await ctx.runQuery(internal.profiles.hasEpisodeForPodcaster, {
      userId,
      podcasterId: args.podcasterId,
    });
    if (!owned) {
      throw new ForbiddenError(FORBIDDEN_PODCASTER_MESSAGE);
    }

    return ctx.runAction(internal.profiles.rebuildPodcasterProfileInternal, args);
  },
});

export const hasEpisodeForPodcaster = internalQuery({
  args: {
    userId: v.string(),
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args) => {
    // `by_user_podcaster` is not on episodes, so scan the (already narrowed)
    // user's rows and match the podcaster in JS. Users have few episodes, so
    // the filtered set stays small.
    const episode = await ctx.db
      .query("episodes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("podcasterId"), args.podcasterId))
      .first();
    return episode !== null;
  },
});

export const rebuildPodcasterProfileInternal = internalAction({
  args: {
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.profiles.getProfileSourceData, {
      podcasterId: args.podcasterId,
    });

    if (payload.episodes.length === 0) {
      return { profile: null };
    }

    const transcriptSamples = payload.episodes
      .map(
        (episode) => `Episode: "${episode.title}"\n${episode.sampleText}`,
      )
      .join("\n\n---\n\n");

    const response = await chatWithLLM([
      {
        role: "system",
        content:
          "You analyze podcast transcripts to build a personality profile of the podcaster. " +
          "Extract speaking style, key opinions, recurring topics, and personality traits. " +
          "Respond in the exact format requested.",
      },
      {
        role: "user",
        content:
          `Analyze these transcript samples and create a profile:\n\n${transcriptSamples}\n\n` +
          "Respond with:\n" +
          "SUMMARY: (2-3 paragraph description)\n" +
          "SPEAKING_STYLE: (one sentence)\n" +
          "TOPICS: (comma-separated list)\n" +
          "PERSONALITY_TRAITS: (comma-separated list)",
      },
    ]);

    const summary = extractSection(response, "SUMMARY") || response;
    const speakingStyle = extractSection(response, "SPEAKING_STYLE");
    const topics = extractCommaList(extractSection(response, "TOPICS"));
    const personalityTraits = extractCommaList(
      extractSection(response, "PERSONALITY_TRAITS"),
    );

    await ctx.runMutation(internal.profiles.upsertPodcasterProfile, {
      podcasterId: args.podcasterId,
      summaryText: summary,
      speakingStyle: speakingStyle || undefined,
      topics,
      personalityTraits,
    });

    return {
      profile: {
        summaryText: summary,
        speakingStyle: speakingStyle || null,
        topics,
        personalityTraits,
      },
    };
  },
});

export const updateUserPodcasterMemoryFromConversation = internalAction({
  args: {
    userId: v.string(),
    podcasterId: v.id("podcasters"),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.runQuery(internal.profiles.getConversationMessages, {
      conversationId: args.conversationId,
    });

    if (messages.length === 0) {
      return { updated: false };
    }

    const conversationText = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const summary = await chatWithLLM([
      {
        role: "system",
        content:
          "Summarize this conversation between a listener and podcaster AI. " +
          "Focus on key topics, insights, and user preferences in 2-3 sentences.",
      },
      { role: "user", content: conversationText },
    ]);

    const topicResponse = await chatWithLLM([
      {
        role: "system",
        content: "Extract key topics as a comma-separated list.",
      },
      { role: "user", content: conversationText },
    ]);

    await ctx.runMutation(internal.profiles.upsertUserPodcasterMemory, {
      userId: args.userId,
      podcasterId: args.podcasterId,
      summary,
      topics: extractCommaList(topicResponse),
    });

    return { updated: true };
  },
});

/**
 * Samples spread across each episode rather than the first/last N chunks.
 *
 * Taking the 5 most recent chunks sampled only the final ~25 seconds of an
 * episode, which is a poor basis for a personality profile.
 *
 * Uses single-pass reservoir sampling (Algorithm R) so each chunk document is
 * read exactly once. The previous `.collect()` read every chunk of every
 * candidate episode, which for ten long episodes is tens of thousands of
 * documents and exceeds Convex's per-transaction read limit.
 */
export const getProfileSourceData = internalQuery({
  args: {
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args) => {
    const episodes = await ctx.db
      .query("episodes")
      .withIndex("by_podcaster", (q) => q.eq("podcasterId", args.podcasterId))
      .order("desc")
      .take(MAX_PROFILE_SOURCE_EPISODES);

    const withSamples = await Promise.all(
      episodes.map(async (episode) => {
        const reservoir: string[] = [];
        let seen = 0;

        for await (const chunk of ctx.db
          .query("transcriptChunks")
          .withIndex("by_episode_start_time", (q) =>
            q.eq("episodeId", episode._id),
          )) {
          if (reservoir.length < PROFILE_SAMPLE_TARGET) {
            reservoir.push(chunk.text);
            continue;
          }

          // Replace an existing sample with probability target/seen. The
          // draw is deterministic so repeated runs sample consistently.
          const j = deterministicBelow(seen, PROFILE_SAMPLE_TARGET);
          if (j < PROFILE_SAMPLE_TARGET) {
            reservoir[j] = chunk.text;
          }
          seen += 1;
        }

        return { title: episode.title, sampleText: reservoir.join(" ") };
      }),
    );

    return { episodes: withSamples };
  },
});

/** Deterministic value in [0, bound) derived from `seed`, for stable sampling. */
function deterministicBelow(seed: number, bound: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % bound;
}

export const getConversationMessages = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
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

export const upsertPodcasterProfile = internalMutation({
  args: {
    podcasterId: v.id("podcasters"),
    summaryText: v.string(),
    speakingStyle: v.optional(v.string()),
    topics: v.array(v.string()),
    personalityTraits: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("podcasterProfiles")
      .withIndex("by_podcaster", (q) => q.eq("podcasterId", args.podcasterId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        summaryText: args.summaryText,
        speakingStyle: args.speakingStyle,
        topics: args.topics,
        personalityTraits: args.personalityTraits,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("podcasterProfiles", {
      podcasterId: args.podcasterId,
      summaryText: args.summaryText,
      speakingStyle: args.speakingStyle,
      topics: args.topics,
      personalityTraits: args.personalityTraits,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertUserPodcasterMemory = internalMutation({
  args: {
    userId: v.string(),
    podcasterId: v.id("podcasters"),
    summary: v.string(),
    topics: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("userPodcasterMemory")
      .withIndex("by_user_podcaster", (q) =>
        q.eq("userId", args.userId).eq("podcasterId", args.podcasterId),
      )
      .first();

    if (existing) {
      const mergedTopics = [
        ...new Set([...existing.keyTopicsDiscussed, ...args.topics]),
      ];
      await ctx.db.patch(existing._id, {
        summaryOfPastInteractions: `${existing.summaryOfPastInteractions}\n\n${args.summary}`,
        keyTopicsDiscussed: mergedTopics,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("userPodcasterMemory", {
      userId: args.userId,
      podcasterId: args.podcasterId,
      summaryOfPastInteractions: args.summary,
      keyTopicsDiscussed: args.topics,
      createdAt: now,
      updatedAt: now,
    });
  },
});

function extractSection(text: string, section: string): string {
  const regex = new RegExp(`${section}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, "s");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function extractCommaList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
