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
 * Trims conversation history to fit a character budget.
 *
 * History is replayed on every turn alongside the full transcript, so an
 * untrimmed conversation makes each successive request quadratically more
 * expensive. Keeps the newest turns and drops from the middle, which is the
 * standard trade for a chat transcript where recency dominates.
 *
 * Always returns a well-formed exchange: it never starts with an assistant
 * turn, and never returns an empty list while messages exist.
 */
export function trimHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxChars: number,
  keepRecentTurns = 12,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (messages.length === 0) return [];

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= maxChars) return messages;

  // Walk backwards from the newest message, admitting turns while they fit.
  // Each kept run must start at a user turn, so an assistant turn is only
  // admitted when the user turn before it already is.
  const kept: Array<{ role: "user" | "assistant"; content: string }> = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const cost = message.content.length;

    if (used + cost > maxChars) break;

    if (message.role === "assistant" && kept.length === 0) {
      // A trailing assistant turn with no user turn before it is unreachable
      // unless the preceding user turn also fits; stop here rather than
      // emitting an assistant-led conversation.
      break;
    }

    kept.unshift(message);
    used += cost;

    // Never keep more than the recency window, regardless of budget.
    if (kept.length >= keepRecentTurns * 2) break;
  }

  // Drop a leading assistant turn if the budget stopped us mid-pair.
  while (kept.length > 0 && kept[0].role !== "user") {
    kept.shift();
  }

  // If not even the newest user turn fits, return that question on its own
  // rather than nothing: the model still needs to know what it is answering.
  if (kept.length === 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        return [messages[i]];
      }
    }
    return [];
  }

  return kept;
}
