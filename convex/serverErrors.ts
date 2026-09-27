import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

export const record = mutation({
  args: {
    token: v.string(),
    id: v.string(),
    timestamp: v.string(),
    source: v.string(),
    name: v.string(),
    message: v.string(),
    stack: v.optional(v.string()),
  },
  handler: async (ctx, { token, ...entry }) => {
    const expectedToken = process.env.ERROR_LOG_INGEST_TOKEN;
    if (!expectedToken || token !== expectedToken) {
      throw new ConvexError("Unauthorized error log write");
    }

    await ctx.db.insert("serverErrors", entry);
  },
});
