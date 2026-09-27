import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, getUserMock, updateMetadataMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getUserMock: vi.fn(),
  updateMetadataMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  clerkClient: async () => ({ users: { getUser: getUserMock, updateUserMetadata: updateMetadataMock } }),
}));

import { GET, PUT, DELETE } from "@/app/api/model-settings/route";

describe("model settings API", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    authMock.mockReset().mockResolvedValue({ userId: "user_one" });
    getUserMock.mockReset().mockResolvedValue({ privateMetadata: {} });
    updateMetadataMock.mockReset().mockResolvedValue({});
    vi.stubEnv("MODEL_CREDENTIALS_KEY", Buffer.alloc(32, 9).toString("base64"));
  });

  it("requires sign-in and never returns saved key material", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    expect((await GET()).status).toBe(401);
    expect(getUserMock).not.toHaveBeenCalled();

    getUserMock.mockResolvedValueOnce({ privateMetadata: {
      livePodcastModels: {
        keys: { openrouter: "v1:private-ciphertext" },
        selection: { provider: "openrouter", model: "openai/gpt-4o-mini" },
      },
    } });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      hasKeys: { openrouter: true, openai: false },
    });
  });

  it("saves an encrypted key for the signed-in user and selected model", async () => {
    const response = await PUT(new Request("http://localhost/api/model-settings", {
      method: "PUT",
      body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-example-secret-key-123" }),
    }));

    expect(response.status).toBe(200);
    expect(updateMetadataMock).toHaveBeenCalledWith("user_one", {
      privateMetadata: { livePodcastModels: {
        keys: { openai: expect.stringMatching(/^v1:/) },
        selection: { provider: "openai", model: "gpt-4o-mini" },
      } },
    });
    expect(JSON.stringify(updateMetadataMock.mock.calls)).not.toContain("sk-example-secret-key-123");
    expect(JSON.stringify(await response.json())).not.toContain("sk-example-secret-key-123");
  });

  it("removes a saved key and its active selection", async () => {
    getUserMock.mockResolvedValueOnce({ privateMetadata: { livePodcastModels: {
      keys: { openai: "v1:encrypted" },
      selection: { provider: "openai", model: "gpt-4o-mini" },
    } } });

    const response = await DELETE(new Request("http://localhost/api/model-settings?provider=openai", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(updateMetadataMock).toHaveBeenCalledWith("user_one", {
      privateMetadata: { livePodcastModels: { keys: { openai: null }, selection: null } },
    });
  });

  it("rejects unsupported providers and malformed model IDs", async () => {
    const response = await PUT(new Request("http://localhost/api/model-settings", {
      method: "PUT",
      body: JSON.stringify({ provider: "other", model: "bad model", apiKey: "sk-example-secret-key-123" }),
    }));
    expect(response.status).toBe(400);
    expect(updateMetadataMock).not.toHaveBeenCalled();
  });
});
