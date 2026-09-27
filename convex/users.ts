import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./auth";

/**
 * Upserts the caller's own profile row.
 *
 * The Clerk user id is taken from the verified session, so this can only ever
 * write the authenticated user's own record — previously it accepted an
 * arbitrary `clerkUserId` argument and would overwrite anyone's email/name.
 */
export const ensureUser = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clerkUserId = await requireUserId(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
      .first();

    if (existing) {
      // Do not clobber known values with undefined from a partial payload.
      await ctx.db.patch(existing._id, {
        ...(args.email !== undefined ? { email: args.email } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.imageUrl !== undefined ? { imageUrl: args.imageUrl } : {}),
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("users", {
      clerkUserId,
      email: args.email,
      name: args.name,
      imageUrl: args.imageUrl,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const clerkUserId = await requireUserId(ctx);
    return ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
      .first();
  },
});
