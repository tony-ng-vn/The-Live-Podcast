import { buildTransfer } from "./fuzzy-brain-sync.mjs";

export function preparePackets({ sourceId, ownerId, items, receipts }) {
  const packets = [];
  for (const item of items) {
    if (!item.messages.length) continue;
    const conversationId = item.conversation._id;
    const prior = receipts[conversationId];
    const packet = buildTransfer({
      sourceId,
      ownerId,
      ...item,
      previousReceiptId: prior?.receiptId ?? null,
    });
    if (packet.revision === prior?.revision) continue;
    packets.push({ conversationId, packet });
  }
  return packets;
}

export function verifyImport(packet, imported, verified) {
  const receipt = verified?.receipt;
  if (imported?.state !== "committed" || verified?.state !== "verified" ||
      imported.id !== receipt?.id ||
      imported.source_id !== packet.source_id ||
      imported.source_key !== packet.source_key ||
      imported.revision !== packet.revision ||
      imported.message_count !== packet.messages.length ||
      receipt.revision !== packet.revision ||
      verified.source?.total_messages !== packet.messages.length) {
    throw new Error("Fuzzy Brain readback mismatch");
  }
  return imported.id;
}
