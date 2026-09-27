import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { superviseServices } from "../../scripts/dev-all.mjs";

function service(name: string) {
  return { name, child: new EventEmitter(), stop: vi.fn() };
}

describe("development service supervisor", () => {
  it("stops the other services when one service exits", async () => {
    const host = new EventEmitter();
    const convex = service("Convex");
    const transcript = service("Transcript");
    const web = service("Web");
    const result = superviseServices([convex, transcript, web], host);

    transcript.child.emit("exit", 2);

    await expect(result).resolves.toBe(2);
    expect(convex.stop).toHaveBeenCalledOnce();
    expect(web.stop).toHaveBeenCalledOnce();
    expect(transcript.stop).not.toHaveBeenCalled();
    expect(host.listenerCount("SIGINT")).toBe(0);
  });

  it("stops all services on Ctrl+C", async () => {
    const host = new EventEmitter();
    const services = [service("Convex"), service("Transcript"), service("Web")];
    const result = superviseServices(services, host);

    host.emit("SIGINT");

    await expect(result).resolves.toBe(130);
    for (const item of services) expect(item.stop).toHaveBeenCalledOnce();
    expect(host.listenerCount("SIGINT")).toBe(0);
  });
});
