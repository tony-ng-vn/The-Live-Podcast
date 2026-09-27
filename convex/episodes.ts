import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { chunkTranscript, extractYouTubeId } from "./transcript";
import { ForbiddenError, requireUserId } from "./auth";
import { FORBIDDEN_EPISODE_MESSAGE } from "../src/lib/convex/auth-messages";

/** Title/youtubeId for an episode the caller owns. */
export const getEpisodeById = query({
  args: {
    episodeId: v.id("episodes"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const episode = await ctx.db.get(args.episodeId);
    if (!episode) return null;
    if (episode.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_EPISODE_MESSAGE);
    }

    return {
      title: episode.title,
      youtubeId: episode.youtubeId,
    };
  },
});

export const listEpisodes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    const episodes = await ctx.db
      .query("episodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    if (episodes.length === 0) return [];

    // Single query for every referenced podcaster instead of one `db.get` per
    // episode — the old N+1 did not batch and scaled with library size.
    const podcasterIds = [...new Set(episodes.map((e) => e.podcasterId))];
    const podcasters = await Promise.all(
      podcasterIds.map((id) => ctx.db.get(id)),
    );
    const podcasterById = new Map(
      podcasters
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => [p._id, p]),
    );

    return episodes.map((episode) => {
      const podcaster = podcasterById.get(episode.podcasterId);
      return {
        id: episode._id,
        title: episode.title,
        youtubeId: episode.youtubeId,
        thumbnailUrl: episode.thumbnailUrl,
        description: episode.description,
        createdAt: episode.createdAt,
        podcaster: podcaster
          ? { id: podcaster._id, name: podcaster.name }
          : { id: "", name: "Unknown podcaster" },
      };
    });
  },
});

/**
 * Episode metadata for the watch page.
 *
 * Deliberately does NOT include transcript chunks: the page needs four fields
 * to render, and a two-hour episode is ~1440 chunks (~1-2 MB) that used to be
 * shipped on every visit. The transcript is fetched separately and paged.
 */
export const getEpisodeDetailInternal = internalQuery({
  args: {
    episodeId: v.id("episodes"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId);
    if (!episode || episode.userId !== args.userId) {
      return null;
    }

    const podcaster = await ctx.db.get(episode.podcasterId);

    return {
      id: episode._id,
      podcasterId: episode.podcasterId,
      youtubeUrl: episode.youtubeUrl,
      youtubeId: episode.youtubeId,
      title: episode.title,
      description: episode.description,
      thumbnailUrl: episode.thumbnailUrl,
      publishedAt: episode.publishedAt,
      createdAt: episode.createdAt,
      updatedAt: episode.updatedAt,
      podcaster: podcaster
        ? {
            id: podcaster._id,
            name: podcaster.name,
            channelUrl: podcaster.channelUrl,
            description: podcaster.description,
          }
        : null,
    };
  },
});

export interface EpisodeDetail {
  id: Id<"episodes">;
  podcasterId: Id<"podcasters">;
  youtubeUrl: string;
  youtubeId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
  podcaster: {
    id: Id<"podcasters">;
    name: string;
    channelUrl: string;
    description?: string;
  } | null;
}

export const getEpisodeDetail = query({
  args: {
    episodeId: v.id("episodes"),
  },
  handler: async (ctx, args): Promise<EpisodeDetail | null> => {
    const userId = await requireUserId(ctx);
    return ctx.runQuery(internal.episodes.getEpisodeDetailInternal, {
      episodeId: args.episodeId,
      userId,
    });
  },
});

const segmentValidator = v.object({
  text: v.string(),
  offset: v.number(),
  duration: v.number(),
});

const MAX_SEGMENTS = 20_000;
const MAX_SEGMENT_TEXT_LENGTH = 2_000;

export const ingestEpisode: ReturnType<typeof action> = action({
  args: {
    url: v.string(),
    podcasterName: v.string(),
    podcasterChannelUrl: v.string(),
    episodeTitle: v.string(),
    thumbnailUrl: v.optional(v.string()),
    segments: v.array(segmentValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const trimmedUrl = args.url.trim();
    const youtubeId = extractYouTubeId(trimmedUrl);

    if (!youtubeId) {
      throw new ConvexError(
        "Invalid YouTube URL. Supported formats: youtube.com/watch, youtu.be, youtube.com/embed, youtube.com/shorts",
      );
    }

    if (args.segments.length === 0) {
      throw new ConvexError("No transcript available for this video");
    }

    if (args.segments.length > MAX_SEGMENTS) {
      throw new ConvexError(
        `Transcript has too many segments (${args.segments.length}, max ${MAX_SEGMENTS})`,
      );
    }

    for (const segment of args.segments) {
      if (
        !Number.isFinite(segment.offset) ||
        !Number.isFinite(segment.duration) ||
        segment.offset < 0 ||
        segment.duration < 0
      ) {
        throw new ConvexError("Transcript segments must have non-negative numeric offsets and durations");
      }
      if (segment.text.length > MAX_SEGMENT_TEXT_LENGTH) {
        throw new ConvexError("Transcript segment text is unexpectedly long");
      }
    }

    const existing = await ctx.runQuery(internal.episodes.getEpisodeByYoutubeId, {
      userId,
      youtubeId,
    });

    if (existing) {
      throw new ConvexError(
        "Episode with this YouTube video has already been ingested",
      );
    }

    const chunks = chunkTranscript(args.segments);
    const podcasterId = await ctx.runMutation(internal.episodes.upsertPodcaster, {
      channelUrl: args.podcasterChannelUrl,
      name: args.podcasterName,
    });

    const episodeId = await ctx.runMutation(
      internal.episodes.createEpisodeWithChunks,
      {
        podcasterId,
        userId,
        youtubeUrl: trimmedUrl,
        youtubeId,
        title: args.episodeTitle,
        thumbnailUrl: args.thumbnailUrl,
        chunks,
      },
    );

    return ctx.runQuery(internal.episodes.getEpisodeDetailInternal, {
      episodeId,
      userId,
    });
  },
});

export const getEpisodeByYoutubeId = internalQuery({
  args: {
    userId: v.string(),
    youtubeId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("episodes")
      .withIndex("by_user_youtube_id", (q) =>
        q.eq("userId", args.userId).eq("youtubeId", args.youtubeId),
      )
      .first();
  },
});

export const upsertPodcaster = internalMutation({
  args: {
    channelUrl: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("podcasters")
      .withIndex("by_channel_url", (q) => q.eq("channelUrl", args.channelUrl))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("podcasters", {
      name: args.name,
      channelUrl: args.channelUrl,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Insert-time batching: a two-hour episode is ~1440 chunks, and issuing that
 * many individual inserts inside one mutation is the slowest part of ingest.
 */
const CHUNK_WRITE_BATCH_SIZE = 128;

export const createEpisodeWithChunks = internalMutation({
  args: {
    podcasterId: v.id("podcasters"),
    userId: v.string(),
    youtubeUrl: v.string(),
    youtubeId: v.string(),
    title: v.string(),
    thumbnailUrl: v.optional(v.string()),
    chunks: v.array(
      v.object({
        text: v.string(),
        startTime: v.number(),
        endTime: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const episodeId = await ctx.db.insert("episodes", {
      userId: args.userId,
      podcasterId: args.podcasterId,
      youtubeUrl: args.youtubeUrl,
      youtubeId: args.youtubeId,
      title: args.title,
      thumbnailUrl: args.thumbnailUrl,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < args.chunks.length; i += CHUNK_WRITE_BATCH_SIZE) {
      const batch = args.chunks.slice(i, i + CHUNK_WRITE_BATCH_SIZE);
      await Promise.all(
        batch.map((chunk) =>
          ctx.db.insert("transcriptChunks", {
            episodeId,
            podcasterId: args.podcasterId,
            text: chunk.text,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
          }),
        ),
      );
    }

    return episodeId;
  },
});
