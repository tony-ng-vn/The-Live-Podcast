import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

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
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
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

  return entry.id;
}
