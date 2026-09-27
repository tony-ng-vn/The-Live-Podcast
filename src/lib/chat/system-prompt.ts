export interface TranscriptChunk {
  text: string;
  startTime: number;
  endTime: number;
}

export function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Length of the "what was just said" window, in seconds. */
const RECENT_WINDOW_SECONDS = 120;

export interface SystemPromptArgs {
  videoTitle: string;
  currentTimestamp: number;
  chunks: TranscriptChunk[];
  podcasterName?: string;
}

/**
 * Builds the system prompt for a viewer asking about a paused moment.
 *
 * LAYOUT IS LOAD-BEARING FOR PROMPT CACHING. Providers cache on an exact
 * prefix, so the stable, high-token content (the transcript) is emitted FIRST
 * and the volatile content (timestamp, "just paused here" excerpt, behavioural
 * rules) comes last.
 *
 * The previous version opened with the timestamp line, which changes on every
 * message — that invalidated the whole prefix and defeated caching entirely.
 * Within a single viewing position the prefix is now byte-identical across
 * turns, so the transcript is billed at the cache rate.
 */
export function buildMvpSystemPrompt(args: SystemPromptArgs): string {
  const { videoTitle, currentTimestamp, chunks, podcasterName } = args;

  const timestampLabel = formatTimestamp(currentTimestamp);
  const transcriptText = chunks.map((c) => c.text).join(" ");

  // Everything below is a suffix: only the last chunk of the transcript
  // changes between messages at the same position.
  const parts: string[] = [];

  parts.push("You are helping a viewer who is watching this conversation.");
  parts.push(
    `Video: "${videoTitle}"${podcasterName ? ` (${podcasterName})` : ""}`,
  );

  if (transcriptText.length > 0) {
    parts.push(
      "Here is everything said in the video up to the point where the viewer paused:",
      transcriptText,
    );
  }

  const recentStart = Math.max(0, currentTimestamp - RECENT_WINDOW_SECONDS);
  const recentChunks = chunks.filter((c) => c.endTime > recentStart);
  const recentText = recentChunks.map((c) => c.text).join(" ");

  if (recentText.length > 0 && recentText !== transcriptText) {
    parts.push(
      `The viewer just paused at ${timestampLabel}, during this part:`,
      recentText,
    );
  } else {
    parts.push(`The viewer just paused at ${timestampLabel}.`);
  }

  parts.push(
    "Respond conversationally. You have general knowledge plus the context above. " +
      "The conversation is anchored to what was just being discussed, but you can draw on " +
      "broader knowledge to give good answers. Be natural. Don't lecture. Talk like a " +
      "knowledgeable friend who watched it with them. Keep answers to a few short paragraphs.",
  );

  return parts.join("\n\n");
}

/**
 * Trims conversation history to fit a token-ish budget.
 *
 * History is replayed on every turn alongside the full transcript, so an
 * untrimmed conversation makes each successive request quadratically more
 * expensive. Keeps the most recent turns and drops the middle, which is the
 * standard trade for a chat transcript where recency dominates.
 *
 * Always preserves a leading user message so the exchange stays well-formed.
 */
export function trimHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxChars: number,
  keepRecentTurns = 12,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (messages.length === 0) return [];

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= maxChars) return messages;

  const recent = messages.slice(-keepRecentTurns);
  const head = messages.slice(0, messages.length - keepRecentTurns);

  // The oldest kept message must be a user turn so the provider does not
  // receive a conversation that opens with an assistant reply.
  while (recent.length > 0 && recent[0].role !== "user") {
    recent.shift();
  }
  if (recent.length === 0) return [];

  let budget = maxChars - recent.reduce((sum, m) => sum + m.content.length, 0);
  const kept: typeof head = [];

  for (let i = head.length - 1; i >= 0; i -= 1) {
    const message = head[i];
    const cost = message.content.length;
    if (cost > budget) break;
    kept.unshift(message);
    budget -= cost;
  }

  if (kept.length > 0 && kept[0].role !== "user") {
    kept.shift();
  }

  return [...kept, ...recent];
}
