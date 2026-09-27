import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Clerk auth route layout", () => {
  it.each(["signin", "signup"])("gives %s a catch-all route for path routing", (route) => {
    const authDir = join(process.cwd(), "src", "app", "auth", route);

    expect(existsSync(join(authDir, "[[...rest]]", "page.tsx"))).toBe(true);
    expect(existsSync(join(authDir, "page.tsx"))).toBe(false);
  });
});
