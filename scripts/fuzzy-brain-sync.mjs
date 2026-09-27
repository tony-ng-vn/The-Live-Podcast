import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { preparePackets, selectPreparedEntry, verifyImport } from "./lib/fuzzy-brain-preparation.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { loadEnvConfig } = nextEnv;
loadEnvConfig(root);
const fuzzyRepo = process.env.FUZZY_BRAIN_REPO || path.resolve(root, "../fuzzy-brain");
const privateDir = process.env.FUZZY_BRAIN_SYNC_DIR || path.join(root, ".local", "fuzzy-brain-sync");
const manifestPath = path.join(privateDir, "manifest.json");
const receiptsPath = path.join(privateDir, "receipts.json");
const envPath = path.join(root, ".env.local");

function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

function writePrivateJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temp, file);
  chmodSync(file, 0o600);
}

function runJson(command, args, cwd, timeout = 60_000) {
  const output = execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function convexQuery(body) {
  const convex = path.join(root, "node_modules", ".bin", "convex");
  return runJson(convex, ["run", "--prod", "--inline-query", body, "--env-file", envPath], root);
}

function brain(command, ...args) {
  return runJson(process.execPath, [path.join(fuzzyRepo, "scripts", "tbrain.mjs"), command, ...args], fuzzyRepo, 120_000);
}

function requireOwner() {
  const ownerId = process.env.FUZZY_BRAIN_OWNER_CLERK_USER_ID;
  if (!ownerId) throw new Error("Set FUZZY_BRAIN_OWNER_CLERK_USER_ID in the private .env.local file.");
  return ownerId;
}

function requireSource() {
  const sourceId = process.env.FUZZY_BRAIN_SOURCE_ID;
  if (!sourceId) throw new Error("Register a Fuzzy Brain source and set FUZZY_BRAIN_SOURCE_ID in the private .env.local file.");
  return sourceId;
}

function listConversations(ownerId) {
  const conversations = [];
  let cursor = null;
  do {
    const page = convexQuery(`return await ctx.db.query("conversations").withIndex("by_user_podcaster", q => q.eq("userId", ${JSON.stringify(ownerId)})).paginate({ cursor: ${JSON.stringify(cursor)}, numItems: 100 });`);
    conversations.push(...page.page);
    if (page.isDone) return conversations;
    cursor = page.continueCursor;
  } while (cursor);
  throw new Error("Convex conversation page did not finish.");
}

function readConversation(ownerId, conversationId) {
  return convexQuery(`const conversation = await ctx.db.get(${JSON.stringify(conversationId)}); if (!conversation || conversation.userId !== ${JSON.stringify(ownerId)}) return null; const episode = await ctx.db.get(conversation.episodeId); const messages = await ctx.db.query("conversationMessages").withIndex("by_conversation", q => q.eq("conversationId", conversation._id)).take(2001); return { conversation, episode, messages };`);
}

function prepare() {
  const ownerId = requireOwner();
  const conversations = listConversations(ownerId);
  if (conversations.length === 0) {
    writePrivateJson(manifestPath, { ownerId, sourceId: process.env.FUZZY_BRAIN_SOURCE_ID ?? null, entries: {} });
    console.log("No saved production chats were found for this owner.");
    return;
  }
  const sourceId = requireSource();
  const items = conversations.map((conversation) => readConversation(ownerId, conversation._id));
  if (items.some((item) => !item)) throw new Error("A saved chat could not be read for this owner.");
  const receipts = readJson(receiptsPath, {});
  const packets = preparePackets({ sourceId, ownerId, items, receipts });
  const entries = {};
  for (const { conversationId, packet } of packets) {
    const key = createHash("sha256").update(conversationId).digest("hex");
    const packetFile = path.join(privateDir, "packets", `${key}-${packet.revision.slice(7)}.json`);
    writePrivateJson(packetFile, packet);
    const validation = brain("validate", packetFile);
    if (!validation.valid) throw new Error(`Fuzzy Brain rejected the preview for ${conversationId}.`);
    entries[conversationId] = { packetFile, revision: packet.revision, messageCount: packet.messages.length, title: packet.source.title };
  }
  writePrivateJson(manifestPath, { ownerId, sourceId, entries });
  console.log(`Prepared ${packets.length} chat(s). No chat was imported.`);
  for (const [id, entry] of Object.entries(entries)) {
    console.log(`${entry.title.replace(/[\r\n]/g, " ")}: ${entry.messageCount} message(s). Review ${entry.packetFile}`);
    console.log(`Import this chat with: npm run sync:fuzzy-brain -- import ${id}`);
  }
}

function importOne(conversationId) {
  if (!conversationId) throw new Error("Give the chat ID shown by the prepare command.");
  const manifest = readJson(manifestPath, {});
  const entry = selectPreparedEntry(manifest, requireOwner(), requireSource(), conversationId);
  const packet = readJson(entry.packetFile, null);
  if (!packet || packet.source.conversation_id !== conversationId ||
      packet.source_id !== requireSource() || packet.revision !== entry.revision) {
    throw new Error("The prepared chat identity changed. Run prepare again.");
  }
  const validation = brain("validate", entry.packetFile);
  if (!validation.valid) throw new Error("Fuzzy Brain rejected the prepared chat.");
  const imported = brain("import", entry.packetFile, "--authorize");
  const verified = brain("verify", imported.id);
  const receiptId = verifyImport(packet, imported, verified);
  const receipts = readJson(receiptsPath, {});
  receipts[conversationId] = { revision: packet.revision, receiptId };
  writePrivateJson(receiptsPath, receipts);
  console.log(`Saved and verified chat ${conversationId}. Receipt: ${receiptId}`);
}

const [command = "prepare", conversationId] = process.argv.slice(2);
try {
  if (command === "prepare") prepare();
  else if (command === "import") importOne(conversationId);
  else throw new Error("Use prepare or import CHAT_ID.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
