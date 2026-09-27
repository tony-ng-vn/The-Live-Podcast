import { createHash } from "node:crypto";

const MAX_TRANSFER_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES = 2000;

function isoTime(value) {
  if (!Number.isFinite(value)) throw new Error("invalid saved message time");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid saved message time");
  return date.toISOString();
}

function videoTime(seconds) {
  if (seconds === undefined || seconds === null) return null;
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("invalid video pause point");
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const formatted = `${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${formatted}` : formatted;
}

/**
 * @param {{
 *   sourceId: string,
 *   ownerId: string,
 *   conversation: { _id: string, userId: string, episodeId: string },
 *   episode: { _id: string, userId?: string, title: string, youtubeId: string },
 *   messages: Array<{ _id: string, role: string, content: string, createdAt: number, _creationTime?: number, timestampInEpisode?: number }>,
 *   previousReceiptId?: string | null,
 * }} options
 */
export function buildTransfer({ sourceId, ownerId, conversation, episode, messages, previousReceiptId = null }) {
  if (!sourceId || !ownerId || !conversation?._id || !episode?._id) {
    throw new Error("missing sync identity");
  }
  if (conversation.userId !== ownerId || episode.userId !== ownerId) {
    throw new Error("conversation owner mismatch");
  }
  if (conversation.episodeId !== episode._id) throw new Error("conversation episode mismatch");
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("conversation has no saved messages");
  if (messages.length > MAX_MESSAGES) throw new Error("conversation has too many messages");

  const ordered = [...messages].sort((left, right) =>
    (left._creationTime ?? left.createdAt) - (right._creationTime ?? right.createdAt) ||
    String(left._id).localeCompare(String(right._id)),
  );
  const ids = new Set();
  const exported = ordered.map((message) => {
    if (!message._id || ids.has(message._id)) throw new Error("invalid saved message ID");
    ids.add(message._id);
    if (!["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" || !message.content.trim()) {
      throw new Error("invalid saved message");
    }
    const speaker = message.role === "user" ? "viewer" : "The Live Podcast";
    const pause = videoTime(message.timestampInEpisode);
    return {
      id: message._id,
      role: message.role,
      speaker: pause ? `${speaker} at video ${pause}` : speaker,
      text: message.content,
      at: isoTime(message.createdAt),
      fidelity: "verbatim",
    };
  });

  // Keep pause times in original evidence without changing the verbatim chat text.
  const original = JSON.stringify({
    conversationId: conversation._id,
    episodeId: episode._id,
    youtubeId: episode.youtubeId,
    messages: ordered.map((message) => ({
      id: message._id,
      role: message.role,
      content: message.content,
      timestampInEpisode: message.timestampInEpisode ?? null,
      createdAt: message.createdAt,
    })),
  });
  const revision = `sha256:${createHash("sha256").update(original).digest("hex")}`;
  const times = exported.map((message) => message.at).sort();
  const packet = {
    format: "tbrain.transfer.v1",
    source_id: sourceId,
    source_key: `the-live-podcast:${conversation._id}`,
    revision,
    source: {
      platform: "The Live Podcast",
      conversation_id: conversation._id,
      title: episode.title,
      project: "The Live Podcast",
    },
    coverage: {
      kind: "source_export",
      completeness: "partial",
      from: times[0],
      until: times.at(-1),
      limitations: ["Only messages saved in Convex are included. Browser-only messages and video captions are omitted."],
      omissions: [],
    },
    messages: exported,
    reflection: null,
    relation: previousReceiptId ? {
      receipt_id: previousReceiptId,
      kind: "source_export",
      note: "Updated saved chat messages from The Live Podcast.",
    } : null,
    original: { media_type: "application/json", text: original },
  };
  if (Buffer.byteLength(JSON.stringify(packet)) > MAX_TRANSFER_BYTES) {
    throw new Error("conversation transfer is too large");
  }
  return packet;
}
