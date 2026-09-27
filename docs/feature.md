# Feature Backlog & Deferred Work

Items documented here are intentionally deferred from the MVP. They represent future iterations, cleanup tasks, and technical debt tracked for later.

## Deferred Features

### Creator Persona & Profiles
- Full roleplay persona (AI responds AS the creator with their speaking style)
- Profile extraction from transcripts (personality, expertise, style)
- `podcasterProfiles` table is in schema — populate it when ready
- Stable podcaster identity via YouTube channel extraction (replace placeholder `Podcaster (${youtubeId})`)

### Cross-Episode Memory
- Per-creator knowledge accumulation across episodes
- `userPodcasterMemory` table is in schema — use it when ready
- `endConversation` memory-building flow (LLM summarization + topic extraction)
- Requires stable podcaster identity first

### Advanced Retrieval
- Semantic/vector search. The `vectorIndex("by_embedding")` and the
  `embedding`/`embeddingSource` fields were **removed** from the schema while
  embeddings were deferred, to avoid paying vector-index write cost on ~1440
  chunk inserts per episode. Re-adding them is a schema change plus an
  embeddings pipeline (local or OpenAI).
- The `convex/embeddings.ts` + `convex/memory.ts` scaffold was deleted as
  unreachable code; recover it from git history
  (`git show 855ee24^:convex/memory.ts`) if you want the starting point.
- Context management research: summarization vs RAG vs hybrid
- Relevant when catalog grows beyond single-episode use

### Voice Mode
- Web Speech API wrappers exist (`src/lib/voice/`)
- Architecture should remain voice-ready (conversational response style)
- Future: upgrade to cloud TTS (ElevenLabs, OpenAI TTS) for creator voice matching

### Deployment
- Transcript sidecar is localhost-only — needs a deployable boundary.
  `TRANSCRIPT_SERVICE_URL` is documented in `.env.example`.
- `CONVEX_AUTH_DOMAIN` must be set on the Convex deployment for auth to work:
  `npx convex env set CONVEX_AUTH_DOMAIN https://<app>.clerk.accounts.dev`
- Ingest is a single blocking request (up to ~75s server-side). A background job
  with progress via `ctx.scheduler` would be more robust than a client timeout.
- The in-process rate limiter is per-instance. Use a shared store (Redis/Upstash)
  if you run more than one instance.

### Library Ownership
- Resolved: episodes are per-user (`episodes.userId`) and every read/write is
  ownership-checked. Note that a podcaster row is shared across users, since it
  is keyed by `channelUrl`.

### Podcaster Identity
- `upsertPodcaster` is keyed on `channelUrl`, which comes from YouTube oEmbed.
  When oEmbed fails, ingestion falls back to `placeholder-${videoId}`, creating a
  new podcaster row per episode and fragmenting the Library grouping. Consider
  resolving the channel id from the video page, or fetching oEmbed with a retry.
- `publishedAt` and `description` are in the schema but never populated; oEmbed
  does not return them.

### Conversation History & Checkpoints
- **Resume conversations from checkpoints** — Each time a user pauses at a timestamp and starts a conversation, save it as a checkpoint. Users can later return to any saved checkpoint and resume that specific conversation from where they left off.
  - Checkpoint persistence: store `(videoId, timestamp, conversationId)` tuples
  - UI: show list of past conversations with their pause points
  - Resume: reload conversation history + context up to that pause point
  - Use case: user pauses at 5:30 to ask about topic A, later pauses at 7:15 to ask about topic B — both conversations remain separate and resumable
- NBrain verification note: feature planning docs are part of the repo documentation graph and should stay linked to documentation maintenance.
- NBrain corrected-database demo note: this repo is imported through the GitHub Repo Documentation database.
- Per-video conversation archive (view all past chats for a video)
- Conversation export/sharing
- Conversation search/filtering

### Multi-model
- Model not only understand the context based on the transcript but also can see what's on the video (using vision capabilities) and can answer questions related to that. This would be a game-changer in terms of interactivity and usefulness, especially for educational content.
