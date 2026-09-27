import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { api, getConvexClient } from "@/lib/convex/client";

const SECRET_ENV_KEYS = [
  "CLERK_SECRET_KEY",
  "SERPAPI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "MODEL_CREDENTIALS_KEY",
  "TRANSCRIPT_SERVICE_TOKEN",
  "ERROR_LOG_INGEST_TOKEN",
] as const;

function redactKnownSecrets(value: string): string {
  const secrets = [...new Set(SECRET_ENV_KEYS
    .map((key) => process.env[key])
    .filter((secret): secret is string => Boolean(secret && secret.length >= 8)))]
    .sort((a, b) => b.length - a.length);

  return secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
}

export async function recordServerError(
  source: string,
  error: unknown,
  file = process.env.NODE_ENV === "production"
    ? undefined
    : path.join(process.cwd(), "logs", "app-errors.jsonl"),
): Promise<string> {
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source,
    name: error instanceof Error ? error.name : "UnknownError",
    message: redactKnownSecrets(error instanceof Error ? error.message : String(error)).slice(0, 2000),
    stack: error instanceof Error && error.stack
      ? redactKnownSecrets(error.stack).slice(0, 8000)
      : undefined,
  };
  const line = JSON.stringify(entry);
  console.error("[app-error]", line);

  if (file) {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${line}\n`, { mode: 0o600 });
    } catch (logError) {
      console.error("[app-error-log-failed]", logError);
    }
  }

  if (process.env.NODE_ENV === "production") {
    const token = process.env.ERROR_LOG_INGEST_TOKEN;
    if (!token) {
      console.error("[app-error-store-unavailable]", entry.id);
    } else {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          getConvexClient().mutation(api.serverErrors.record, { ...entry, token }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Error storage timed out")), 1500);
          }),
        ]);
      } catch {
        console.error("[app-error-store-failed]", entry.id);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  }

  return entry.id;
}
