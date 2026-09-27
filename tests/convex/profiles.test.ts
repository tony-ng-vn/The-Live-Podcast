import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import type { DataModel, Id } from "../../convex/_generated/dataModel";
import type { TestConvexForDataModel } from "convex-test";
import { convexModules } from "../helpers/convex-modules";

type Backend = TestConvexForDataModel<DataModel>;

/**
 * Profile sampling must be spread across the whole episode.
 *
 * The first implementation drew the reservoir index from the wrong range and
 * never advanced its counter, so every sample ended up in the final ~9% of the
 * episode — reintroducing exactly the defect the change was meant to fix.
 */
async function seedLongEpisode(
  t: Backend,
  chunkCount: number,
): Promise<{ episodeId: Id<"episodes">; podcasterId: Id<"podcasters"> }> {
  const podcasterId = await t.mutation(internal.episodes.upsertPodcaster, {
    channelUrl: "https://www.youtube.com/@long",
    name: "Long Host",
  });

  const episodeId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("episodes", {
      userId: "user_a",
      podcasterId,
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      youtubeId: "dQw4w9WgXcQ",
      title: "Long Episode",
      createdAt: 0,
      updatedAt: 0,
    });
    for (let i = 0; i < chunkCount; i += 1) {
      await ctx.db.insert("transcriptChunks", {
        episodeId: id,
        podcasterId,
        text: `chunk-${i}`,
        startTime: i * 5,
        endTime: i * 5 + 5,
      });
    }
    return id;
  });

  return { episodeId, podcasterId };
}

describe("getProfileSourceData sampling", () => {
  it("samples across the whole episode, not just the tail", async () => {
    const t = convexTest(schema, convexModules);
    const { podcasterId } = await seedLongEpisode(t, 400);

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.profiles.getProfileSourceData, { podcasterId }),
    );

    const sample = result.episodes[0]?.sampleText ?? "";
    expect(sample.length).toBeGreaterThan(0);

    const indices = Array.from(sample.matchAll(/chunk-(\d+)/g))
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);

    // Bounded sample.
    expect(indices.length).toBeLessThanOrEqual(36);
    expect(indices.length).toBeGreaterThan(10);
    // No duplicates, so every sampled slot is a distinct chunk.
    expect(new Set(indices).size).toBe(indices.length);

    // The two properties the broken version failed: it must not be confined to
    // the tail, and it must not be confined to the head.
    expect(indices[0]).toBeLessThan(400 * 0.25);
    expect(indices[indices.length - 1]).toBeGreaterThan(400 * 0.75);

    // The decisive check. The broken version sampled chunks 0-35 plus a single
    // trailing chunk, so it passed a naive "spans the episode" assertion while
    // covering nothing in the middle. Require the interior to be populated
    // across every quarter of the episode.
    for (const [lo, hi] of [
      [0, 100],
      [100, 200],
      [200, 300],
      [300, 400],
    ]) {
      expect(
        indices.filter((i) => i >= lo && i < hi).length,
      ).toBeGreaterThan(0);
    }

    // Every quarter should contribute a meaningful share, not a single chunk.
    for (const [lo, hi] of [
      [0, 100],
      [100, 200],
      [200, 300],
      [300, 400],
    ]) {
      expect(indices.filter((i) => i >= lo && i < hi).length).toBeGreaterThan(1);
    }
  });

  it("returns an empty sample for an episode with no chunks", async () => {
    const t = convexTest(schema, convexModules);
    const podcasterId = await t.mutation(internal.episodes.upsertPodcaster, {
      channelUrl: "https://www.youtube.com/@empty",
      name: "Empty Host",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("episodes", {
        userId: "user_a",
        podcasterId,
        youtubeUrl: "https://youtu.be/aaaaaaaaaaa",
        youtubeId: "aaaaaaaaaaa",
        title: "No Transcript",
        createdAt: 0,
        updatedAt: 0,
      });
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.profiles.getProfileSourceData, { podcasterId }),
    );

    expect(result.episodes[0]?.sampleText).toBe("");
  });

  it("samples only the configured number of recent episodes", async () => {
    const t = convexTest(schema, convexModules);
    const podcasterId = await t.mutation(internal.episodes.upsertPodcaster, {
      channelUrl: "https://www.youtube.com/@many",
      name: "Many Host",
    });

    await t.run(async (ctx) => {
      for (let i = 0; i < 8; i += 1) {
        const id = await ctx.db.insert("episodes", {
          userId: "user_a",
          podcasterId,
          youtubeUrl: `https://youtu.be/${String(i).padStart(11, "0")}`,
          youtubeId: String(i).padStart(11, "0"),
          title: `Episode ${i}`,
          createdAt: i,
          updatedAt: i,
        });
        await ctx.db.insert("transcriptChunks", {
          episodeId: id,
          podcasterId,
          text: `text-${i}`,
          startTime: 0,
          endTime: 5,
        });
      }
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.profiles.getProfileSourceData, { podcasterId }),
    );

    // Capped at 5 to stay inside Convex's per-transaction read limit.
    expect(result.episodes.length).toBeLessThanOrEqual(5);
  });
});

describe("conversationMessages role validator", () => {
  let t: Backend;

  beforeEach(async () => {
    t = convexTest(schema, convexModules);
    await seedLongEpisode(t, 1);
  });

  it("rejects a role outside the union", async () => {
    const { podcasterId, episodeId } = await seedLongEpisode(t, 1);
    const conversationId = await t.run(async (ctx) =>
      ctx.db.insert("conversations", {
        userId: "user_a",
        podcasterId,
        episodeId,
        timestampInEpisode: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await expect(
      t.run((ctx) =>
        ctx.db.insert("conversationMessages", {
          conversationId,
          role: "system" as never,
          content: "sneaky",
          createdAt: 0,
        }),
      ),
    ).rejects.toThrow();
  });
});
