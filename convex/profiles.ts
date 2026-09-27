import { v } from "convex/values";
import { chatWithLLM } from "./llm";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { ForbiddenError, requireUserId } from "./auth";
import { FORBIDDEN_PODCASTER_MESSAGE } from "../src/lib/convex/auth-messages";

export interface EpisodeProfileSource {
  title: string;
  sampleText: string;
}

export interface ProfileSourceData {
  episodes: EpisodeProfileSource[];
}

const MAX_PROFILE_SOURCE_EPISODES = 3;
/** Chunks sampled per episode. */
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
    const payload = await ctx.runAction(
      internal.profiles.getProfileSourceData,
      { podcasterId: args.podcasterId },
    );

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
 * Counts an episode's chunks.
 *
 * A separate function on purpose: Convex permits only one paginated query per
 * function execution, so counting and sampling cannot share an execution. A
 * plain `for await` needs no pagination and therefore costs nothing extra.
 */
export const countEpisodeChunks = internalQuery({
  args: {
    episodeId: v.id("episodes"),
  },
  handler: async (ctx, args): Promise<number> => {
    // Plain iteration, not `.paginate()`: it needs no pagination budget, which
    // is why counting can share an execution with nothing else.
    const chunks = ctx.db
      .query("transcriptChunks")
      .withIndex("by_episode_start_time", (q) =>
        q.eq("episodeId", args.episodeId),
      );

    let total = 0;
    for await (const chunk of chunks) {
      if (chunk._id) total += 1;
    }

    return total;
  },
});

/**
 * Samples an episode by taking the first chunk of each of
 * `PROFILE_SAMPLE_TARGET` equal-width windows spanning the whole episode.
 *
 * Even coverage requires knowing the length, so this is a second pass over the
 * episode (see getProfileSourceData). It is its own function because each pass
 * needs its own execution.
 *
 * Uses plain iteration rather than `.paginate()`: Convex permits only one
 * `paginate()` call per function execution, so a paging loop cannot walk a
 * long episode at all.
 *
 * A plain stride (`index % stride`) is subtly wrong here: it samples the opening
 * densely and stops short of the closing minutes, so the end of a long episode
 * is never represented. Equal-width windows always include the final window.
 */
export const sampleEpisodeChunks = internalQuery({
  args: {
    episodeId: v.id("episodes"),
    total: v.number(),
  },
  handler: async (ctx, args): Promise<string[]> => {
    if (args.total <= 0) return [];

    const sampled: string[] = [];
    const takenWindows = new Set<number>();
    let index = 0;

    for await (const chunk of ctx.db
      .query("transcriptChunks")
      .withIndex("by_episode_start_time", (q) =>
        q.eq("episodeId", args.episodeId),
      )) {
      // Which equal-width window this chunk starts. Monotonic in `index`, so
      // each window is entered exactly once.
      const window = Math.floor((index * PROFILE_SAMPLE_TARGET) / args.total);
      if (!takenWindows.has(window)) {
        takenWindows.add(window);
        sampled.push(chunk.text);
        if (sampled.length >= PROFILE_SAMPLE_TARGET) break;
      }
      index += 1;
    }

    return sampled;
  },
});

/** Most recent episodes for a podcaster, newest first. */
export const listPodcasterEpisodes = internalQuery({
  args: {
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args): Promise<Array<{ id: Id<"episodes">; title: string }>> => {
    const episodes = await ctx.db
      .query("episodes")
      .withIndex("by_podcaster", (q) => q.eq("podcasterId", args.podcasterId))
      .order("desc")
      .take(MAX_PROFILE_SOURCE_EPISODES);

    return episodes.map((episode) => ({ id: episode._id, title: episode.title }));
  },
});

/**
 * Samples spread across each episode rather than the first/last N chunks.
 *
 * Taking the 5 most recent chunks sampled only the final ~25 seconds of an
 * episode, which is a poor basis for a personality profile.
 *
 * Even coverage needs the length, so this counts then samples. A reservoir
 * (Algorithm R) was tried first and rejected: driving the draw from a
 * deterministic hash of the chunk index is not a uniform random variable, so the
 * sample still skewed measurably toward the opening of long episodes.
 *
 * This is an action rather than a query on purpose. A query's `ctx.runQuery`
 * shares the caller's execution, so orchestrating several episodes from a query
 * concentrates every read into one transaction. As an action, each `runQuery`
 * below is its own execution, which keeps the per-transaction read cost of one
 * episode independent of how many episodes are sampled.
 */
export const getProfileSourceData = internalAction({
  args: {
    podcasterId: v.id("podcasters"),
  },
  handler: async (ctx, args): Promise<ProfileSourceData> => {
    const episodes = await ctx.runQuery(
      internal.profiles.listPodcasterEpisodes,
      { podcasterId: args.podcasterId },
    );

    const withSamples: EpisodeProfileSource[] = await Promise.all(
      episodes.map(async (episode): Promise<EpisodeProfileSource> => {
        const total: number = await ctx.runQuery(
          internal.profiles.countEpisodeChunks,
          { episodeId: episode.id },
        );

        if (total === 0) {
          return { title: episode.title, sampleText: "" };
        }

        const sampled: string[] = await ctx.runQuery(
          internal.profiles.sampleEpisodeChunks,
          { episodeId: episode.id, total },
        );

        return { title: episode.title, sampleText: sampled.join(" ") };
      }),
    );

    return { episodes: withSamples };
  },
});

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
