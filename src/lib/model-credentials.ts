import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type ModelProvider = "openrouter" | "openai";

function encryptionKey(): Buffer {
  const configured = process.env.MODEL_CREDENTIALS_KEY;
  const key = configured ? Buffer.from(configured, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error("MODEL_CREDENTIALS_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function binding(userId: string, provider: ModelProvider): Buffer {
  return Buffer.from(`live-podcast:model-key:v1:${userId}:${provider}`, "utf8");
}

export function encryptModelKey(value: string, userId: string, provider: ModelProvider): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(binding(userId, provider));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(":");
}

export function decryptModelKey(saved: string, userId: string, provider: ModelProvider): string {
  const [version, nonceText, ciphertextText, tagText, extra] = saved.split(":");
  if (version !== "v1" || !nonceText || !ciphertextText || !tagText || extra) {
    throw new Error("Stored model key format is invalid");
  }
  const nonce = Buffer.from(nonceText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (nonce.length !== 12 || tag.length !== 16) {
    throw new Error("Stored model key format is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  decipher.setAAD(binding(userId, provider));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}
