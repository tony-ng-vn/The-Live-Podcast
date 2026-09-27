import { v } from "convex/values";
import { query } from "./_generated/server";
import { selectTranscriptUpToTimestamp } from "./transcript";
import { requireClerkUser, requireRecordOwner } from "./auth";

export const getChunksUpToTimestamp = query({
  args: {
    episodeId: v.id("episodes"),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireClerkUser(ctx.auth);
    const episode = await ctx.db.get(args.episodeId);
    if (!episode) return [];
    requireRecordOwner(episode.userId, userId);
    const chunks = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_episode_start_time", (q) =>
        q.eq("episodeId", args.episodeId)
      )
      .collect();

    return selectTranscriptUpToTimestamp(chunks, args.timestamp);
  },
});
