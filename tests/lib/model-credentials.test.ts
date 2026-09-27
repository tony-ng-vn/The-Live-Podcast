import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptModelKey, encryptModelKey } from "@/lib/model-credentials";

describe("saved model credentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("encrypts a key and binds it to its owner and provider", () => {
    vi.stubEnv("MODEL_CREDENTIALS_KEY", Buffer.alloc(32, 7).toString("base64"));
    const saved = encryptModelKey("sk-example-secret", "user_one", "openrouter");

    expect(saved).not.toContain("sk-example-secret");
    expect(decryptModelKey(saved, "user_one", "openrouter")).toBe("sk-example-secret");
    expect(() => decryptModelKey(saved, "user_two", "openrouter")).toThrow();
    expect(() => decryptModelKey(saved, "user_one", "openai")).toThrow();
  });

  it("rejects an edited authentication tag and invalid encryption configuration", () => {
    vi.stubEnv("MODEL_CREDENTIALS_KEY", Buffer.alloc(32, 7).toString("base64"));
    const saved = encryptModelKey("sk-example-secret", "user_one", "openai");
    const parts = saved.split(":");
    const tag = Buffer.from(parts[3], "base64url");
    tag[0] ^= 1;
    parts[3] = tag.toString("base64url");
    expect(() => decryptModelKey(parts.join(":"), "user_one", "openai")).toThrow();

    vi.stubEnv("MODEL_CREDENTIALS_KEY", "short");
    expect(() => encryptModelKey("sk-example-secret", "user_one", "openai")).toThrow();
  });
});
