import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { ForbiddenError, requireUserId } from "./auth";
import { FORBIDDEN_EPISODE_MESSAGE } from "../src/lib/convex/auth-messages";

/**
 * Transcript chunks at or before the viewer's pause point.
 *
 * Uses an index range bound on `startTime` rather than collecting the whole
 * episode and filtering in JS — at the end of a long episode the naive version
 * shipped every chunk on every message.
 *
 * The episode must belong to the caller.
 */
export const getChunksUpToTimestamp = query({
  args: {
    episodeId: v.id("episodes"),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const episode = await ctx.db.get(args.episodeId);
    if (!episode) {
      throw new ConvexError("Episode not found");
    }
    if (episode.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_EPISODE_MESSAGE);
    }

    if (!Number.isFinite(args.timestamp) || args.timestamp < 0) {
      throw new ConvexError("timestamp must be a non-negative number");
    }

    const chunks = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_episode_start_time", (q) =>
        q.eq("episodeId", args.episodeId).lte("startTime", args.timestamp),
      )
      .collect();

    return chunks.map((chunk) => ({
      text: chunk.text,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
    }));
  },
});

/**
 * Transcript chunks for the scrubber UI. Paged so a long episode does not ship
 * its entire transcript to the browser on load.
 */
export const listChunksPaged = query({
  args: {
    episodeId: v.id("episodes"),
    pagination: v.optional(
      v.object({ numItems: v.number(), endCursor: v.union(v.string(), v.null()) }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const episode = await ctx.db.get(args.episodeId);
    if (!episode) {
      throw new ConvexError("Episode not found");
    }
    if (episode.userId !== userId) {
      throw new ForbiddenError(FORBIDDEN_EPISODE_MESSAGE);
    }

    const pageSize = Math.min(
      Math.max(args.pagination?.numItems ?? 200, 1),
      500,
    );

    const chunks = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_episode_start_time", (q) =>
        q.eq("episodeId", args.episodeId),
      )
      .paginate({ numItems: pageSize, cursor: args.pagination?.endCursor ?? null });

    return {
      page: chunks.page.map((chunk) => ({
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        text: chunk.text,
      })),
      isDone: chunks.isDone,
      continueCursor: chunks.continueCursor,
    };
  },
});
