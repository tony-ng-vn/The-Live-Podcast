import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  currentUserMock,
  apiRefs,
  mutationMock,
  queryMock,
  streamMock,
  personalProviderMock,
  savedSettingsMock,
  decryptModelKeyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<{ userId: string | null }>>(),
  currentUserMock: vi.fn(),
  apiRefs: {
    users: { ensureUser: "users.ensureUser" },
    chat: {
      startConversation: "chat.startConversation",
      appendAssistantMessage: "chat.appendAssistantMessage",
      listConversationMessages: "chat.listConversationMessages",
    },
    transcriptChunks: {
      getChunksUpToTimestamp: "transcriptChunks.getChunksUpToTimestamp",
    },
    episodes: {
      getEpisodeById: "episodes.getEpisodeById",
    },
  },
  mutationMock: vi.fn(),
  queryMock: vi.fn(),
  streamMock: vi.fn(),
  personalProviderMock: vi.fn(),
  savedSettingsMock: vi.fn(),
  decryptModelKeyMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));

vi.mock("@/lib/convex/client", () => ({
  api: apiRefs,
  getConvexClient: () => ({
    mutation: mutationMock,
    query: queryMock,
  }),
  isConvexConfigurationError: () => false,
}));

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => ({
    chat: vi.fn(),
    stream: streamMock,
  }),
  createPersonalLLMProvider: personalProviderMock,
}));

vi.mock("@/lib/model-settings", () => ({
  readSavedModelSettings: savedSettingsMock,
}));

vi.mock("@/lib/model-credentials", () => ({
  decryptModelKey: decryptModelKeyMock,
}));

import { POST } from "@/app/api/chat/route";

async function* oneTokenStream(): AsyncGenerator<string, void, unknown> {
  yield "hello";
}

async function drainStream(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  let finished = false;
  while (!finished) {
    const { done } = await reader.read();
    finished = done;
  }
}

describe("POST /api/chat validation", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "ollama");
    authMock.mockResolvedValue({ userId: "server_user" });
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "user@example.com" }],
      fullName: "Server User",
      imageUrl: "https://example.com/avatar.png",
    });

    mutationMock.mockReset();
    queryMock.mockReset();
    streamMock.mockReset();
    personalProviderMock.mockReset().mockReturnValue({ stream: streamMock });
    savedSettingsMock.mockReset().mockReturnValue({ keys: {} });
    decryptModelKeyMock.mockReset().mockReturnValue("sk-private-key");

    mutationMock.mockImplementation(
      async (ref: string, args: Record<string, unknown>) => {
        if (ref === apiRefs.users.ensureUser) {
          return "user_doc";
        }
        if (ref === apiRefs.chat.startConversation) {
          return { conversationId: "conv_1" };
        }
        if (ref === apiRefs.chat.appendAssistantMessage) {
          return "msg_1";
        }
        throw new Error(`Unexpected mutation ref: ${ref} (${JSON.stringify(args)})`);
      },
    );

    queryMock.mockImplementation(
      async (ref: string) => {
        if (ref === apiRefs.transcriptChunks.getChunksUpToTimestamp) {
          return [{ text: "some transcript", startTime: 0, endTime: 15 }];
        }
        if (ref === apiRefs.episodes.getEpisodeById) {
          return { title: "Test Episode", youtubeId: "abc123" };
        }
        if (ref === apiRefs.chat.listConversationMessages) {
          return [];
        }
        return [];
      },
    );
    streamMock.mockReturnValue(oneTokenStream());
  });

  it("returns 400 when required payload fields are missing", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: "episode_1", message: "hello" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing required fields");
  });

  it("returns 400 for whitespace-only messages", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 12,
        message: "   \n\t ",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Message cannot be empty or whitespace-only",
    });
  });

  it("uses authenticated userId and ignores any client-provided userId", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 30,
        message: "Can you recap?",
        userId: "attacker_user",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await drainStream(res);

    const startConversationCall = mutationMock.mock.calls.find(
      (call) => call[0] === apiRefs.chat.startConversation,
    );

    expect(startConversationCall).toBeDefined();
    const args = startConversationCall?.[1] as { userId: string };
    expect(args.userId).toBe("server_user");
    expect(args.userId).not.toBe("attacker_user");
  });

  it("uses the signed-in user's saved provider, key, and model", async () => {
    savedSettingsMock.mockReturnValue({
      keys: { openrouter: "encrypted" },
      selection: { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
    });
    const res = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        episodeId: "episode_1", podcasterId: "podcaster_1", timestamp: 30,
        message: "Explain this", apiKey: "attacker-key", model: "attacker-model",
      }),
    }));

    expect(res.status).toBe(200);
    await drainStream(res);
    expect(decryptModelKeyMock).toHaveBeenCalledWith("encrypted", "server_user", "openrouter");
    expect(personalProviderMock).toHaveBeenCalledWith("openrouter", "sk-private-key");
    expect(streamMock).toHaveBeenCalledWith(expect.any(Array), { model: "anthropic/claude-sonnet-4" });
  });

  it("passes the pause point when reading and saving conversation messages", async () => {
    const res = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        episodeId: "episode_1", podcasterId: "podcaster_1", timestamp: 30,
        message: "Explain this",
      }),
    }));

    expect(res.status).toBe(200);
    await drainStream(res);
    expect(queryMock).toHaveBeenCalledWith(apiRefs.chat.listConversationMessages, {
      conversationId: "conv_1", timestamp: 30,
    });
    expect(mutationMock).toHaveBeenCalledWith(apiRefs.chat.appendAssistantMessage, {
      conversationId: "conv_1", content: "hello", timestamp: 30,
    });
  });

  it("asks for a saved key before creating a conversation", async () => {
    savedSettingsMock.mockReturnValue({
      keys: {},
      selection: { provider: "openai", model: "gpt-4o-mini" },
    });
    const res = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        episodeId: "episode_1", podcasterId: "podcaster_1", timestamp: 30,
        message: "Explain this",
      }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("API key"), code: "MODEL_KEY_REQUIRED" });
    expect(mutationMock).not.toHaveBeenCalledWith(apiRefs.chat.startConversation, expect.anything());
  });

  it("asks for model settings when the local provider has no key", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        episodeId: "episode_1", podcasterId: "podcaster_1", timestamp: 30,
        message: "Explain this",
      }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("Model settings"), code: "MODEL_KEY_REQUIRED" });
    expect(mutationMock).not.toHaveBeenCalledWith(apiRefs.chat.startConversation, expect.anything());
  });

  it("hides conversation setup failures from the user", async () => {
    mutationMock.mockImplementation(async (ref: string) => {
      if (ref === apiRefs.chat.startConversation) {
        throw new Error("Internal Convex details that should stay in logs");
      }
      return "user_doc";
    });
    const res = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        episodeId: "episode_1", podcasterId: "podcaster_1", timestamp: 30,
        message: "Explain this",
      }),
    }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Oops, someone stole the apple. Please try again while I find another one.",
      errorId: expect.any(String),
    });
  });
});
