import { describe, expect, it } from "vitest";
import { buildTransfer } from "../../scripts/lib/fuzzy-brain-sync.mjs";

const sourceId = "f932975f-a0d2-46c2-b97b-58befa4f5f20";
const conversation = {
  _id: "conv_1",
  userId: "tony_user",
  episodeId: "episode_1",
};
const episode = {
  _id: "episode_1",
  title: "A sample video",
  youtubeId: "video_1",
  userId: "tony_user",
};
const messages = [
  {
    _id: "message_1",
    role: "user",
    content: "What did the speaker say so far?",
    timestampInEpisode: 42,
    createdAt: 1_700_000_000_000,
  },
  {
    _id: "message_2",
    role: "assistant",
    content: "The speaker introduced the idea.",
    timestampInEpisode: 42,
    createdAt: 1_700_000_001_000,
  },
];

describe("Fuzzy Brain transfer", () => {
  it("exports only saved chat text and keeps the video pause point in original evidence", () => {
    const packet = buildTransfer({ sourceId, ownerId: "tony_user", conversation, episode, messages });

    expect(packet.source_key).toBe("the-live-podcast:conv_1");
    expect(packet.coverage.kind).toBe("source_export");
    expect(packet.coverage.completeness).toBe("partial");
    expect(packet.messages.map((message) => message.text)).toEqual(messages.map((message) => message.content));
    expect(packet.original?.text).toContain('"timestampInEpisode":42');
    expect(JSON.stringify(packet)).not.toContain("future transcript");
    expect(buildTransfer({ sourceId, ownerId: "tony_user", conversation, episode, messages }).revision).toBe(packet.revision);
  });

  it("links a changed chat to its previous receipt", () => {
    const packet = buildTransfer({
      sourceId,
      ownerId: "tony_user",
      conversation,
      episode,
      messages: [...messages, { ...messages[0], _id: "message_3", content: "One more question" }],
      previousReceiptId: "21654527-7fc7-44cf-9b89-50fd0d6210c9",
    });

    expect(packet.relation).toEqual({
      receipt_id: "21654527-7fc7-44cf-9b89-50fd0d6210c9",
      kind: "source_export",
      note: "Updated saved chat messages from The Live Podcast.",
    });
  });

  it("rejects another user's chat before making a transfer", () => {
    expect(() => buildTransfer({ sourceId, ownerId: "tony_user", conversation: { ...conversation, userId: "other" }, episode, messages })).toThrow("owner mismatch");
    expect(() => buildTransfer({ sourceId, ownerId: "tony_user", conversation, episode: { ...episode, userId: "other" }, messages })).toThrow("owner mismatch");
  });

  it("rejects incomplete or oversized exports", () => {
    expect(() => buildTransfer({ sourceId, ownerId: "tony_user", conversation, episode, messages: [] })).toThrow("no saved messages");
    expect(() => buildTransfer({ sourceId, ownerId: "tony_user", conversation, episode, messages: Array(2001).fill(messages[0]) })).toThrow("too many messages");
    expect(() => buildTransfer({ sourceId, ownerId: "tony_user", conversation, episode, messages: [{ ...messages[0], content: "x".repeat(2_100_000) }] })).toThrow("too large");
  });
});
