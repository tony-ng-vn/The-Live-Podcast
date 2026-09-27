import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { TestConvexForDataModel } from "convex-test";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { DataModel, Id } from "../../convex/_generated/dataModel";
import { MAX_MESSAGE_LENGTH } from "../../src/lib/chat/limits";
import { convexModules } from "../helpers/convex-modules";

type Backend = TestConvexForDataModel<DataModel>;

/** Builds an isolated in-memory Convex backend with the app's real modules. */
function backend(): Backend {
  return convexTest(schema, convexModules);
}

/** `withIdentity` needs a subject, not a bare string. */
function asUser(t: Backend, subject: string): Backend {
  return t.withIdentity({ subject });
}

/**
 * Authorization boundary tests.
 *
 * Before the auth refactor every public function trusted a caller-supplied
 * `userId`, and the deployment URL is public, so any function could be called
 * directly with someone else's id. These run against a real in-memory Convex
 * backend with identities, so they fail if a guard is removed.
 */

async function seed(t: Backend, opts: { userId: string; youtubeId?: string }) {
  const podcasterId = await t.mutation(internal.episodes.upsertPodcaster, {
    channelUrl: `https://www.youtube.com/@${opts.userId}`,
    name: `Host ${opts.userId}`,
  });

  const episodeId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("episodes", {
      userId: opts.userId,
      podcasterId,
      youtubeUrl: `https://youtube.com/watch?v=${opts.youtubeId ?? "dQw4w9WgXcQ"}`,
      youtubeId: opts.youtubeId ?? "dQw4w9WgXcQ",
      title: "Episode",
      createdAt: 0,
      updatedAt: 0,
    });
    for (let i = 0; i < 3; i += 1) {
      await ctx.db.insert("transcriptChunks", {
        episodeId: id,
        podcasterId,
        text: `line ${i}`,
        startTime: i * 5,
        endTime: i * 5 + 5,
      });
    }
    return id;
  });

  return { podcasterId, episodeId };
}

describe("transcriptChunks.getChunksUpToTimestamp", () => {
  it("rejects an unauthenticated caller", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });

    await expect(
      t.query(api.transcriptChunks.getChunksUpToTimestamp, {
        episodeId,
        timestamp: 30,
      }),
    ).rejects.toThrow(/Unauthenticated/i);
  });

  it("rejects a caller who does not own the episode", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_b" });

    await expect(
      asUser(t, "user_a").query(api.transcriptChunks.getChunksUpToTimestamp, {
        episodeId,
        timestamp: 30,
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("returns chunks up to the timestamp for the owner", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });

    const chunks = await t
      .withIdentity({ subject: "user_a" })
      .query(api.transcriptChunks.getChunksUpToTimestamp, {
        episodeId,
        timestamp: 7,
      });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ text: "line 0", startTime: 0, endTime: 5 });
  });

  it("rejects a negative timestamp", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });

    await expect(
      asUser(t, "user_a").query(api.transcriptChunks.getChunksUpToTimestamp, {
        episodeId,
        timestamp: -1,
      }),
    ).rejects.toThrow(/non-negative/i);
  });
});

describe("transcriptChunks.listChunksPaged", () => {
  it("refuses to page a transcript the caller does not own", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_b" });

    await expect(
      asUser(t, "user_a").query(api.transcriptChunks.listChunksPaged, {
        episodeId,
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("pages and reports completion", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });

    const page = await t
      .withIdentity({ subject: "user_a" })
      .query(api.transcriptChunks.listChunksPaged, {
        episodeId,
        pagination: { numItems: 2, endCursor: null },
      });

    expect(page.page).toHaveLength(2);
    expect(page.isDone).toBe(false);
  });

  it("clamps an absurd page size", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });

    const page = await t
      .withIdentity({ subject: "user_a" })
      .query(api.transcriptChunks.listChunksPaged, {
        episodeId,
        pagination: { numItems: 100_000, endCursor: null },
      });

    expect(page.page.length).toBeLessThanOrEqual(500);
  });
});

describe("chat.startConversation", () => {
  it("rejects an unauthenticated caller", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });

    await expect(
      t.mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi",
      }),
    ).rejects.toThrow(/Unauthenticated/i);
  });

  it("rejects a caller who does not own the episode", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_b" });

    await expect(
      asUser(t, "user_a").mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi",
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("rejects a podcaster that does not match the episode", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });
    const otherPodcasterId = await t.mutation(
      internal.episodes.upsertPodcaster,
      { channelUrl: "https://www.youtube.com/@other", name: "Other" },
    );

    await expect(
      asUser(t, "user_a").mutation(api.chat.startConversation, {
        episodeId,
        podcasterId: otherPodcasterId,
        timestamp: 10,
        message: "hi",
      }),
    ).rejects.toThrow(/does not belong to the specified podcaster/i);
  });

  it("rejects an oversized message", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });

    await expect(
      asUser(t, "user_a").mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "x".repeat(MAX_MESSAGE_LENGTH + 1),
      }),
    ).rejects.toThrow(/too long/i);
  });

  it("rejects a whitespace-only message", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });

    await expect(
      asUser(t, "user_a").mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "   \n\t ",
      }),
    ).rejects.toThrow(/whitespace-only/i);
  });

  it("records the conversation under the verified identity", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });

    const { conversationId } = await t
      .withIdentity({ subject: "user_a" })
      .mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "  hello  ",
      });

    const stored = await t.run(async (ctx) => {
      const convo = await ctx.db.get(conversationId);
      const messages = await ctx.db
        .query("conversationMessages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect();
      return { convo, messages };
    });

    const convo = stored.convo as { userId: string } | null;
    expect(convo?.userId).toBe("user_a");
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0].content).toBe("hello");
  });

  it("refuses to append to a conversation owned by someone else", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });

    const { conversationId } = await t
      .withIdentity({ subject: "user_a" })
      .mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi",
      });

    await expect(
      asUser(t, "user_b").mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi again",
        conversationId,
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("refuses to reuse a conversation from a different episode", async () => {
    const t = backend();
    const first = await seed(t, { userId: "user_a", youtubeId: "aaaaaaaaaaa" });
    const second = await seed(t, { userId: "user_a", youtubeId: "bbbbbbbbbbb" });

    const { conversationId } = await t
      .withIdentity({ subject: "user_a" })
      .mutation(api.chat.startConversation, {
        episodeId: first.episodeId,
        podcasterId: first.podcasterId,
        timestamp: 10,
        message: "hi",
      });

    await expect(
      asUser(t, "user_a").mutation(api.chat.startConversation, {
        episodeId: second.episodeId,
        podcasterId: second.podcasterId,
        timestamp: 10,
        message: "hi",
        conversationId,
      }),
    ).rejects.toThrow(/different episode/i);
  });
});

describe("chat.listConversationMessages", () => {
  // Each test builds its own backend: a conversationId created in a beforeEach
  // backend does not exist in the backend created inside the test.
  async function seeded() {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });
    const { conversationId } = await t
      .withIdentity({ subject: "user_a" })
      .mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi",
      });
    return { t, conversationId };
  }

  it("rejects an unauthenticated caller", async () => {
    const { t, conversationId } = await seeded();
    await expect(
      t.query(api.chat.listConversationMessages, { conversationId }),
    ).rejects.toThrow(/Unauthenticated/i);
  });

  it("does not leak another user's conversation", async () => {
    const { t, conversationId } = await seeded();
    await expect(
      asUser(t, "user_b").query(api.chat.listConversationMessages, {
        conversationId,
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("returns the owner's messages", async () => {
    const { t, conversationId } = await seeded();
    const messages = await t
      .withIdentity({ subject: "user_a" })
      .query(api.chat.listConversationMessages, { conversationId });

    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("chat.appendAssistantMessage", () => {
  it("rejects a write into another user's conversation", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });
    const { conversationId } = await t
      .withIdentity({ subject: "user_a" })
      .mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi",
      });

    await expect(
      asUser(t, "user_b").mutation(api.chat.appendAssistantMessage, {
        conversationId,
        content: "injected",
      }),
    ).rejects.toThrow(/does not belong/i);

    const count = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("conversationMessages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect();
      return rows.length;
    });
    expect(count).toBe(1);
  });

  it("rejects an unauthenticated caller", async () => {
    const t = backend();
    const { episodeId, podcasterId } = await seed(t, { userId: "user_a" });
    const { conversationId } = await t
      .withIdentity({ subject: "user_a" })
      .mutation(api.chat.startConversation, {
        episodeId,
        podcasterId,
        timestamp: 10,
        message: "hi",
      });

    await expect(
      t.mutation(api.chat.appendAssistantMessage, {
        conversationId,
        content: "x",
      }),
    ).rejects.toThrow(/Unauthenticated/i);
  });
});

describe("episodes", () => {
  it("listEpisodes is scoped to the caller", async () => {
    const t = backend();
    await seed(t, { userId: "user_a", youtubeId: "aaaaaaaaaaa" });
    await seed(t, { userId: "user_b", youtubeId: "bbbbbbbbbbb" });

    const mine = await asUser(t, "user_a").query(api.episodes.listEpisodes, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].podcaster.name).toBe("Host user_a");

    const theirs = await t
      .withIdentity({ subject: "user_b" })
      .query(api.episodes.listEpisodes, {});
    expect(theirs[0].podcaster.name).toBe("Host user_b");
  });

  it("listEpisodes rejects an unauthenticated caller", async () => {
    const t = backend();
    await expect(t.query(api.episodes.listEpisodes, {})).rejects.toThrow(
      /Unauthenticated/i,
    );
  });

  it("getEpisodeDetail returns null for another user's episode", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_b" });

    // Returning null rather than throwing is deliberate: a 403 would confirm
    // the episode exists, which is itself a leak.
    const detail = await asUser(t, "user_a").query(api.episodes.getEpisodeDetail, {
      episodeId,
    });

    expect(detail).toBeNull();
  });

  it("getEpisodeDetail returns metadata without transcript chunks", async () => {
    const t = backend();
    const { episodeId } = await seed(t, { userId: "user_a" });

    const detail = await t
      .withIdentity({ subject: "user_a" })
      .query(api.episodes.getEpisodeDetail, { episodeId });

    expect(detail?.title).toBe("Episode");
    // Shipping the transcript here was ~1-2 MB per page load.
    expect(detail).not.toHaveProperty("transcriptChunks");
  });

  it("ingestEpisode rejects an unauthenticated caller", async () => {
    const t = backend();

    await expect(
      t.action(api.episodes.ingestEpisode, {
        url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        podcasterName: "Host",
        podcasterChannelUrl: "https://www.youtube.com/@host",
        episodeTitle: "Ep",
        segments: [{ text: "hi", offset: 0, duration: 2 }],
      }),
    ).rejects.toThrow(/Unauthenticated/i);
  });

  it("ingestEpisode rejects malformed segment timings", async () => {
    const t = backend();

    await expect(
      asUser(t, "user_a").action(api.episodes.ingestEpisode, {
        url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        podcasterName: "Host",
        podcasterChannelUrl: "https://www.youtube.com/@host",
        episodeTitle: "Ep",
        segments: [{ text: "hi", offset: -1, duration: 2 }],
      }),
    ).rejects.toThrow(/non-negative/i);
  });

  it("ingestEpisode stores the episode under the verified identity", async () => {
    const t = backend();

    const result = await asUser(t, "user_a").action(
      api.episodes.ingestEpisode,
      {
        url: "https://youtu.be/dQw4w9WgXcQ",
        podcasterName: "Host",
        podcasterChannelUrl: "https://www.youtube.com/@host",
        episodeTitle: "Ep",
        segments: [
          { text: "one", offset: 0, duration: 3 },
          { text: "two", offset: 3, duration: 3 },
        ],
      },
    );

    const episodeId: Id<"episodes"> = result.id;
    const owner = await t.run(async (ctx) => {
      const episode = await ctx.db.get(episodeId);
      if (!episode) throw new Error("episode missing");
      const chunks = await ctx.db
        .query("transcriptChunks")
        .withIndex("by_episode_start_time", (q) => q.eq("episodeId", episodeId))
        .collect();
      return { userId: episode.userId, chunkCount: chunks.length };
    });

    expect(owner.userId).toBe("user_a");
    expect(owner.chunkCount).toBe(1);
  });

  it("ingestEpisode refuses a duplicate for the same user", async () => {
    const t = backend();
    const args = {
      url: "https://youtu.be/dQw4w9WgXcQ",
      podcasterName: "Host",
      podcasterChannelUrl: "https://www.youtube.com/@host",
      episodeTitle: "Ep",
      segments: [{ text: "one", offset: 0, duration: 3 }],
    };

    await asUser(t, "user_a").action(api.episodes.ingestEpisode, args);

    await expect(
      asUser(t, "user_a").action(api.episodes.ingestEpisode, args),
    ).rejects.toThrow(/already been ingested/i);
  });
});

describe("users.ensureUser", () => {
  it("rejects an unauthenticated caller", async () => {
    const t = backend();
    await expect(
      t.mutation(api.users.ensureUser, { email: "attacker@example.com" }),
    ).rejects.toThrow(/Unauthenticated/i);
  });

  it("writes the authenticated user", async () => {
    const t = backend();
    await asUser(t, "user_a").mutation(api.users.ensureUser, {
      email: "a@example.com",
      name: "A",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.clerkUserId).toBe("user_a");
    expect(row?.email).toBe("a@example.com");
  });

  it("does not clobber known values with a partial payload", async () => {
    const t = backend();
    await asUser(t, "user_a").mutation(api.users.ensureUser, {
      email: "known@example.com",
      name: "Known",
    });
    await asUser(t, "user_a").mutation(api.users.ensureUser, {});

    const rows = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(rows[0]?.email).toBe("known@example.com");
    expect(rows[0]?.name).toBe("Known");
  });
});

describe("profiles", () => {
  it("rebuildPodcasterProfile refuses a podcaster the caller has no episodes for", async () => {
    const t = backend();
    const { podcasterId } = await seed(t, { userId: "user_b" });

    await expect(
      asUser(t, "user_a").action(api.profiles.rebuildPodcasterProfile, {
        podcasterId,
      }),
    ).rejects.toThrow(/do not have any episodes/i);
  });

  it("rebuildPodcasterProfile rejects an unauthenticated caller", async () => {
    const t = backend();
    const { podcasterId } = await seed(t, { userId: "user_a" });

    await expect(
      t.action(api.profiles.rebuildPodcasterProfile, { podcasterId }),
    ).rejects.toThrow(/Unauthenticated/i);
  });

  it("getPodcasterById rejects an unauthenticated caller", async () => {
    const t = backend();
    const { podcasterId } = await seed(t, { userId: "user_a" });

    await expect(
      t.query(api.profiles.getPodcasterById, { podcasterId }),
    ).rejects.toThrow(/Unauthenticated/i);
  });
});

describe("removed surface", () => {
  it("no longer exports an admin module with a database reset", async () => {
    // convex/admin.ts used to export an unauthenticated `resetAllData` that
    // deleted every row in the database. It must not exist in the public API.
    expect(Object.keys(api)).not.toContain("admin");
  });
});
