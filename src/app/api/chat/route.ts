import { currentUser } from "@clerk/nextjs/server";
import { getLLMProvider } from "@/lib/llm";
import type { Message } from "@/lib/llm/types";
import { api } from "@/lib/convex/client";
import {
  requireAuthedContext,
  statusForConvexError,
  toErrorResponse,
} from "@/lib/convex/require-auth";
import { asConvexId } from "@/lib/convex/ids";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/limits";
import { buildMvpSystemPrompt, trimHistory } from "@/lib/chat/system-prompt";

interface ChatRequestBody {
  episodeId?: string;
  podcasterId?: string;
  timestamp?: number;
  message?: string;
  conversationId?: string;
}

type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Character budget for replayed conversation history. */
const HISTORY_CHAR_BUDGET = 12_000;

const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60_000;

const encoder = new TextEncoder();

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx/Vercel from buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let authed;
  try {
    authed = await requireAuthedContext();
  } catch (error) {
    return toErrorResponse(error, "Authentication failed");
  }
  const { userId, convex } = authed;

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return jsonError("Invalid request body", 400);
  }

  if (!body || typeof body !== "object") {
    return jsonError("Invalid request body", 400);
  }

  const { episodeId, podcasterId, timestamp, message, conversationId } = body;

  if (typeof episodeId !== "string" || episodeId.trim() === "") {
    return jsonError("Missing required field: episodeId", 400);
  }
  if (typeof podcasterId !== "string" || podcasterId.trim() === "") {
    return jsonError("Missing required field: podcasterId", 400);
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
    return jsonError("Missing or invalid required field: timestamp", 400);
  }
  if (typeof message !== "string" || message.trim() === "") {
    return jsonError("Message cannot be empty or whitespace-only", 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonError(
      `Message is too long (${message.length} characters, max ${MAX_MESSAGE_LENGTH})`,
      400,
    );
  }

  // Rate limited after validation so malformed requests cannot exhaust a
  // viewer's quota. This is the only brake between a client and the LLM bill.
  const limit = rateLimit(`chat:${userId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return Response.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const typedEpisodeId = asConvexId<"episodes">(episodeId);
  const typedPodcasterId = asConvexId<"podcasters">(podcasterId);
  const typedConversationId =
    typeof conversationId === "string" && conversationId.trim() !== ""
      ? asConvexId<"conversations">(conversationId)
      : undefined;

  // Best-effort profile sync. A failure here must not block the conversation.
  const clerkUser = await currentUser().catch(() => null);
  await convex
    .mutation(api.users.ensureUser, {
      email: clerkUser?.emailAddresses[0]?.emailAddress,
      name: clerkUser?.fullName ?? undefined,
      imageUrl: clerkUser?.imageUrl,
    })
    .catch(() => undefined);

  let activeConversationId;
  try {
    const start = await convex.mutation(api.chat.startConversation, {
      episodeId: typedEpisodeId,
      podcasterId: typedPodcasterId,
      timestamp,
      message,
      conversationId: typedConversationId,
    });
    activeConversationId = start.conversationId;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Conversation setup failed";
    return jsonError(errorMessage, statusForConvexError(errorMessage));
  }

  // Gather prompt inputs before opening the response so failures can still
  // return a real status code instead of an SSE error frame.
  let llmMessages: Message[];
  try {
    const [chunks, episode] = await Promise.all([
      convex.query(api.transcriptChunks.getChunksUpToTimestamp, {
        episodeId: typedEpisodeId,
        timestamp,
      }),
      convex.query(api.episodes.getEpisodeById, {
        episodeId: typedEpisodeId,
      }),
    ]);

    const videoTitle = episode?.title ?? "this video";

    const priorMessages = await convex.query(
      api.chat.listConversationMessages,
      { conversationId: activeConversationId },
    );

    const systemMessage: Message = {
      role: "system",
      content: buildMvpSystemPrompt({
        videoTitle,
        currentTimestamp: timestamp,
        chunks,
      }),
    };

    // The system message stays first and untrimmed (it is the cached prefix);
    // only the replayed history is bounded.
    llmMessages = [
      systemMessage,
      ...trimHistory(
        priorMessages.map((m) => ({ role: m.role, content: m.content })),
        HISTORY_CHAR_BUDGET,
      ),
    ];
  } catch (error) {
    return toErrorResponse(error, "AI service is currently unavailable.");
  }

  const conversationIdForStream = String(activeConversationId);
  // Aborted when the response body is cancelled (client disconnected).
  const providerAbort = new AbortController();

  // Return the stream immediately instead of awaiting the first token, so
  // time-to-first-byte is not gated on the provider handshake.
  const body_ = new ReadableStream<Uint8Array>({
    /**
     * Called when the client goes away. Aborting the provider fetch here is
     * what makes the client's AbortController actually stop the token spend;
     * without it the server would keep streaming to nobody.
     */
    cancel() {
      providerAbort.abort();
    },
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed (client disconnected).
        }
      };

      let fullContent = "";

      try {
        send({ type: "conversation", conversationId: conversationIdForStream });

        const stream = getLLMProvider().stream(llmMessages, {
          signal: providerAbort.signal,
        });

        for await (const token of stream) {
          if (providerAbort.signal.aborted) break;
          fullContent += token;
          send({ type: "token", content: token });
        }

        if (providerAbort.signal.aborted) {
          // Persist whatever arrived before the viewer left, then stop.
          if (fullContent.length > 0) {
            await convex
              .mutation(api.chat.appendAssistantMessage, {
                conversationId: activeConversationId,
                content: fullContent,
              })
              .catch(() => undefined);
          }
          return;
        }

        if (fullContent.length > 0) {
          await convex
            .mutation(api.chat.appendAssistantMessage, {
              conversationId: activeConversationId,
              content: fullContent,
            })
            .catch(() => undefined);
        }

        send({ type: "done" });
      } catch (error) {
        // The provider request carries `providerAbort.signal`, so an aborted
        // read surfaces here rather than at the guard above. Persist whatever
        // arrived first: dropping it would leave the user's question in the
        // history with no answer, a shape that cannot otherwise occur.
        if (fullContent.length > 0) {
          await convex
            .mutation(api.chat.appendAssistantMessage, {
              conversationId: activeConversationId,
              content: fullContent,
            })
            .catch(() => undefined);
        }

        if (providerAbort.signal.aborted) return;

        const message =
          error instanceof Error
            ? error.message
            : "Streaming failed before the response could be saved.";

        // Persist whatever streamed before the failure so the turn is not lost.
        if (fullContent.length > 0) {
          await convex
            .mutation(api.chat.appendAssistantMessage, {
              conversationId: activeConversationId,
              content: fullContent,
            })
            .catch(() => undefined);
        }

        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return sseResponse(body_);
}
