import { describe, expect, it } from "vitest";
import { preparePackets, selectPreparedEntry, verifyImport } from "../../scripts/lib/fuzzy-brain-preparation.mjs";

const sourceId = "f932975f-a0d2-46c2-b97b-58befa4f5f20";
const receiptId = "21654527-7fc7-44cf-9b89-50fd0d6210c9";
const item = {
  conversation: { _id: "conv_1", userId: "tony_user", episodeId: "episode_1" },
  episode: { _id: "episode_1", userId: "tony_user", title: "A sample video", youtubeId: "video_1" },
  messages: [{ _id: "message_1", role: "user", content: "A question", createdAt: 1_700_000_000_000 }],
};

describe("Fuzzy Brain preparation", () => {
  it("prepares changed saved chats and skips empty chats", () => {
    const packets = preparePackets({ sourceId, ownerId: "tony_user", items: [item, { ...item, conversation: { ...item.conversation, _id: "conv_2" }, messages: [] }], receipts: {} });
    expect(packets).toHaveLength(1);
    expect(packets[0].conversationId).toBe("conv_1");
    expect(packets[0].packet.messages).toHaveLength(1);
  });

  it("skips a committed revision and links the next revision", () => {
    const first = preparePackets({ sourceId, ownerId: "tony_user", items: [item], receipts: {} })[0];
    const receipts = { conv_1: { revision: first.packet.revision, receiptId } };
    expect(preparePackets({ sourceId, ownerId: "tony_user", items: [item], receipts })).toEqual([]);
    const changed = preparePackets({ sourceId, ownerId: "tony_user", items: [{ ...item, messages: [...item.messages, { ...item.messages[0], _id: "message_2", content: "Another question" }] }], receipts });
    expect(changed[0].packet.relation?.receipt_id).toBe(receiptId);
  });

  it("requires a matching readback before recording an import", () => {
    const packet = preparePackets({ sourceId, ownerId: "tony_user", items: [item], receipts: {} })[0].packet;
    const result = { id: receiptId, state: "committed", source_id: sourceId, source_key: packet.source_key, revision: packet.revision, message_count: 1 };
    const verified = { state: "verified", receipt: result, source: { total_messages: 1 } };
    expect(verifyImport(packet, result, verified)).toBe(receiptId);
    expect(() => verifyImport(packet, result, { ...verified, source: { total_messages: 0 } })).toThrow("readback mismatch");
  });

  it("keeps a preview bound to the owner and registered source", () => {
    const entry = { packetFile: "/private/packet.json", revision: "revision", messageCount: 1 };
    const manifest = { ownerId: "tony_user", sourceId, entries: { conv_1: entry } };
    expect(selectPreparedEntry(manifest, "tony_user", sourceId, "conv_1")).toBe(entry);
    expect(() => selectPreparedEntry(manifest, "other", sourceId, "conv_1")).toThrow("preview identity mismatch");
    expect(() => selectPreparedEntry(manifest, "tony_user", "other", "conv_1")).toThrow("preview identity mismatch");
  });
});
