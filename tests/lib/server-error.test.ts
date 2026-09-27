import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mutationMock } = vi.hoisted(() => ({ mutationMock: vi.fn() }));

vi.mock("@/lib/convex/client", () => ({
  api: { serverErrors: { record: "serverErrors.record" } },
  getConvexClient: () => ({ mutation: mutationMock }),
}));

import { recordServerError } from "../../src/lib/server-error";

const folders: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  mutationMock.mockReset();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("recordServerError", () => {
  it("writes a searchable JSON line without request data", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "live-podcast-error-"));
    folders.push(folder);
    const file = path.join(folder, "logs", "app-errors.jsonl");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const id = await recordServerError("episodes.list", new Error("Convex deployment disabled"), file);
    const entry = JSON.parse((await readFile(file, "utf8")).trim());

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry).toMatchObject({
      id,
      source: "episodes.list",
      name: "Error",
      message: "Convex deployment disabled",
    });
    expect(entry.timestamp).toBeTruthy();
    expect(entry.stack).toContain("Convex deployment disabled");
    expect(consoleError).toHaveBeenCalledWith("[app-error]", JSON.stringify(entry));
  });

  it("stores a redacted production error in Convex", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ERROR_LOG_INGEST_TOKEN", "private-ingest-token");
    vi.stubEnv("OPENAI_API_KEY", "private-model-key");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const id = await recordServerError("chat.response", new Error("OpenAI rejected private-model-key"));

    expect(mutationMock).toHaveBeenCalledWith("serverErrors.record", expect.objectContaining({
      id,
      source: "chat.response",
      message: "OpenAI rejected [redacted]",
      token: "private-ingest-token",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-model-key");
  });

  it("keeps the friendly error ID when durable storage is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ERROR_LOG_INGEST_TOKEN", "private-ingest-token");
    mutationMock.mockRejectedValue(new Error("Convex unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordServerError("episodes.list", new Error("Library failed")))
      .resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not make viewers wait for a stalled error store", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ERROR_LOG_INGEST_TOKEN", "private-ingest-token");
    mutationMock.mockReturnValue(new Promise(() => {}));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const pending = recordServerError("chat.response", new Error("Provider failed"));
    await vi.advanceTimersByTimeAsync(1500);

    await expect(pending).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });
});
