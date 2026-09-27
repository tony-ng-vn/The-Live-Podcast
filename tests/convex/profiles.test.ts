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

/** Seeds one episode of `chunkCount` chunks and returns the profile sample. */
async function seedAndSample(
  t: Backend,
  chunkCount: number,
): Promise<string> {
  const podcasterId = await t.mutation(internal.episodes.upsertPodcaster, {
    channelUrl: `https://www.youtube.com/@host-${chunkCount}-${Math.random()}`,
    name: `Host ${chunkCount}`,
  });

  await t.run(async (ctx) => {
    const id = await ctx.db.insert("episodes", {
      userId: "user_a",
      podcasterId,
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      youtubeId: "dQw4w9WgXcQ",
      title: `Episode ${chunkCount}`,
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
  });

  const result = await t.action(internal.profiles.getProfileSourceData, {
    podcasterId,
  });
  return result.episodes[0]?.sampleText ?? "";
}

describe("getProfileSourceData sampling", () => {
  it("samples across the whole episode, not just the tail", async () => {
    const t = convexTest(schema, convexModules);
    const { podcasterId } = await seedLongEpisode(t, 400);

    const result = await t.action(internal.profiles.getProfileSourceData, {
      podcasterId,
    });

    const sample = result.episodes[0]?.sampleText ?? "";
    expect(sample.length).toBeGreaterThan(0);

    const indices = Array.from(sample.matchAll(/chunk-(\d+)/g))
      .map((match: unknown) => Number((match as RegExpMatchArray)[1]))
      .sort((a: number, b: number) => a - b);

    // Bounded sample.
    expect(indices.length).toBeLessThanOrEqual(36);
    expect(indices.length).toBeGreaterThan(10);
    // No duplicates, so every sampled slot is a distinct chunk.
    expect(new Set(indices).size).toBe(indices.length);

    // The decisive checks. A naive "spans the episode" assertion passed against
    // the broken sampler, which covered chunks 0-35 plus a single trailing
    // chunk. Require every decile to contribute, across several lengths —
    // including the long-episode regime where a hash-based draw skewed worst.
    for (const total of [200, 400, 1440]) {
      const long = await seedAndSample(t, total);
      const picked = Array.from(long.matchAll(/chunk-(\d+)/g))
        .map((match: unknown) => Number((match as RegExpMatchArray)[1]))
        .sort((a: number, b: number) => a - b);

      expect(picked.length).toBeGreaterThan(10);
      expect(new Set(picked).size).toBe(picked.length);

      const deciles = new Array(10).fill(0);
      for (const i of picked) {
        deciles[Math.min(9, Math.floor((i / total) * 10))] += 1;
      }
      // Every decile of the episode must be represented.
      for (const [d, count] of deciles.entries()) {
        expect(
          count,
          `n=${total} decile ${d} was empty (picked ${picked.length} of ${total})`,
        ).toBeGreaterThan(0);
      }
      // And no decile may hold the whole sample.
      expect(Math.max(...deciles)).toBeLessThan(picked.length);
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

    const result = await t.action(internal.profiles.getProfileSourceData, {
      podcasterId,
    });

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

    const result = await t.action(internal.profiles.getProfileSourceData, {
      podcasterId,
    });

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
