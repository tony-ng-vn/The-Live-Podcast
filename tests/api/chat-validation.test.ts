import { beforeEach, describe, expect, it, vi } from "vitest";
import { authResult, TEST_AUTH_TOKEN } from "../helpers/auth";

const {
  authMock,
  currentUserMock,
  getConvexClientMock,
  apiRefs,
  mutationMock,
  queryMock,
  streamMock,
  __resetRateLimits,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  currentUserMock: vi.fn(),
  getConvexClientMock: vi.fn(),
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
  __resetRateLimits: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));

vi.mock("@/lib/convex/client", () => ({
  api: apiRefs,
  getConvexClient: getConvexClientMock,
  isConvexConfigurationError: () => false,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ allowed: true, remaining: 19, retryAfterSeconds: 60 }),
  __resetRateLimits: __resetRateLimits,
}));

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => ({
    chat: vi.fn(),
    stream: streamMock,
  }),
}));

import { POST } from "@/app/api/chat/route";

async function* oneTokenStream(): AsyncGenerator<string, void, unknown> {
  yield "hello";
}

async function* manyTokenStream(): AsyncGenerator<string, void, unknown> {
  yield "a";
  yield "b";
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

function chatRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat validation", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(authResult("server_user"));
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "user@example.com" }],
      fullName: "Server User",
      imageUrl: "https://example.com/avatar.png",
    });

    getConvexClientMock.mockReset();
    mutationMock.mockReset();
    queryMock.mockReset();
    streamMock.mockReset();

    getConvexClientMock.mockReturnValue({
      mutation: mutationMock,
      query: queryMock,
    });

    mutationMock.mockImplementation(async (ref: string) => {
      if (ref === apiRefs.users.ensureUser) return "user_doc";
      if (ref === apiRefs.chat.startConversation) {
        return { conversationId: "conv_1" };
      }
      if (ref === apiRefs.chat.appendAssistantMessage) return { ok: true };
      throw new Error(`Unexpected mutation ref: ${ref}`);
    });

    queryMock.mockImplementation(async (ref: string) => {
      if (ref === apiRefs.transcriptChunks.getChunksUpToTimestamp) {
        return [{ text: "some transcript", startTime: 0, endTime: 15 }];
      }
      if (ref === apiRefs.episodes.getEpisodeById) {
        return { title: "Test Episode", youtubeId: "abc123" };
      }
      if (ref === apiRefs.chat.listConversationMessages) return [];
      return [];
    });

    streamMock.mockReturnValue(oneTokenStream());
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(authResult(null));

    const res = await POST(chatRequest({ episodeId: "e1", message: "hi" }));
    expect(res.status).toBe(401);
    expect(getConvexClientMock).not.toHaveBeenCalled();
  });

  it("binds the Convex client to the Clerk session token", async () => {
    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 30,
        message: "hi",
      }),
    );
    expect(res.status).toBe(200);
    await drainStream(res);

    // Identity reaches Convex only via a verified token, never via args.
    expect(getConvexClientMock).toHaveBeenCalledWith(TEST_AUTH_TOKEN);
  });

  it("never forwards a userId to Convex, so client input cannot spoof identity", async () => {
    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 30,
        message: "Can you recap?",
        userId: "attacker_user",
        clerkUserId: "attacker_user",
      }),
    );
    expect(res.status).toBe(200);
    await drainStream(res);

    const startConversationCall = mutationMock.mock.calls.find(
      (call) => call[0] === apiRefs.chat.startConversation,
    );
    expect(startConversationCall).toBeDefined();

    const args = startConversationCall?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("userId");
    expect(JSON.stringify(args)).not.toContain("attacker_user");
  });

  it("returns 400 when required payload fields are missing", async () => {
    const res = await POST(chatRequest({ episodeId: "episode_1", message: "hello" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("podcasterId");
  });

  it("returns 400 for whitespace-only messages", async () => {
    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 12,
        message: "   \n\t ",
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Message cannot be empty or whitespace-only",
    });
  });

  it("rejects a negative or non-numeric timestamp", async () => {
    for (const timestamp of [-1, Number.NaN, "12"]) {
      const res = await POST(
        chatRequest({
          episodeId: "episode_1",
          podcasterId: "podcaster_1",
          timestamp,
          message: "hi",
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects an oversized message before any LLM call", async () => {
    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 12,
        message: "x".repeat(4_001),
      }),
    );
    expect(res.status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("streams conversation, token and done events", async () => {
    streamMock.mockReturnValue(manyTokenStream());

    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 30,
        message: "hi",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace("data: ", "")));

    expect(events.map((e) => e.type)).toEqual([
      "conversation",
      "token",
      "token",
      "done",
    ]);
    expect(events[0].conversationId).toBe("conv_1");
  });

  it("persists the assembled assistant response once the stream completes", async () => {
    streamMock.mockReturnValue(manyTokenStream());

    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 30,
        message: "hi",
      }),
    );
    await drainStream(res);
    await vi.waitFor(() => {
      const call = mutationMock.mock.calls.find(
        (c) => c[0] === apiRefs.chat.appendAssistantMessage,
      );
      expect(call).toBeDefined();
      expect((call?.[1] as { content: string }).content).toBe("ab");
    });
  });

  it("returns 403 when Convex reports an ownership violation", async () => {
    mutationMock.mockImplementation(async (ref: string) => {
      if (ref === apiRefs.users.ensureUser) return "user_doc";
      if (ref === apiRefs.chat.startConversation) {
        throw new Error("Episode does not belong to the authenticated user");
      }
      return { ok: true };
    });

    const res = await POST(
      chatRequest({
        episodeId: "episode_1",
        podcasterId: "podcaster_1",
        timestamp: 30,
        message: "hi",
      }),
    );
    expect(res.status).toBe(403);
  });
});
