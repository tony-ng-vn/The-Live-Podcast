import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordServerError } from "../../src/lib/server-error";

const folders: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
});
