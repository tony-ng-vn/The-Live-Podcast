# The Live Podcast

An interactive app that lets you talk to any YouTube video in real time. Paste a URL, watch the video, pause when something is unclear or interesting, and ask a question — the AI answers with full awareness of what's being discussed at that moment.

## Problem

1. **Manual friction** — to ask an AI about a video, you have to copy-paste the transcript into ChatGPT.
2. **No context awareness** — pasting the full transcript means the AI has everything at once. It doesn't know where you are in the video or what matters to you right now.

## How It Works

1. Paste a YouTube URL — the transcript is auto-fetched and stored
2. Watch the video
3. Pause at any point and click "Jump In"
4. Ask a question via text or voice
5. Get a contextually aware answer anchored to what was just being discussed
6. Chat as long as you want — hit "Resume" to continue watching

The AI has general knowledge plus the full context of what's been discussed up to your pause point. It responds conversationally, like a knowledgeable friend who watched the video with you.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript (strict mode, `verbatimModuleSyntax`)
- **Styling:** Tailwind CSS 4
- **Data layer:** Convex
- **Auth:** Clerk (verified at both the Next.js route and the Convex function)
- **LLM:** Provider-agnostic (OpenAI, Ollama, or any OpenAI-compatible API)
- **Transcript:** Python sidecar service (youtube-transcript-api)

## Setup

```bash
npm install
cp .env.example .env
```

Fill in your `.env` with:
- Convex deployment URL (`NEXT_PUBLIC_CONVEX_URL`)
- Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)
- LLM provider config (`LLM_PROVIDER`, API keys for your chosen provider)
- Transcript service URL (`TRANSCRIPT_SERVICE_URL`, defaults to `http://127.0.0.1:8765`)

### Authentication (required)

Convex verifies Clerk session tokens itself, so identity never has to be passed
as an argument. Set the issuer on your Convex deployment once:

```bash
npx convex env set CONVEX_AUTH_DOMAIN https://<your-app>.clerk.accounts.dev
```

Without this, `ctx.auth` is always null and every authenticated API route
returns 401. See `convex/auth.config.ts` and `convex/auth.ts`.

How it fits together:

```
Browser ──▶ Next.js route handler ──▶ ConvexHttpClient (bearer: Clerk token)
                                          │
                                          ▼
                                   ctx.auth.getUserIdentity()  ← the only source of userId
```

`requireAuthedContext()` returns a Convex client bound to the caller's session
token, and `requireUserId(ctx)` inside each Convex function resolves the user.
Authenticated clients are deliberately **not** cached — a cached client would
replay a stale token and cross user boundaries.

### Start the dev stack

```bash
# Terminal 1: Convex backend
npm run convex:dev

# Terminal 2: Transcript service
npm run transcript:dev

# Terminal 3: Next.js frontend
npm run dev
```

The transcript service requires Python 3.11+. Install its dependencies first:

```bash
npm run transcript:install
```

If you run the transcript service on a different host or port, update
`TRANSCRIPT_SERVICE_URL` in `.env` before ingesting episodes.

## Testing

```bash
npm run verify         # lint + typecheck + test + build
npm test               # vitest (143 tests)
npm run typecheck      # tsc over src/, convex/, tests/
npm run lint           # eslint, fails on warnings
npm run build          # production build
npm run test:watch     # watch mode
```

The suite covers the Convex authorization boundaries against a real in-memory
Convex backend (`convex-test`), the streaming hook in jsdom, prompt construction
and history trimming, transcript chunking, and the API route validation
contracts.

## Project Structure

```
src/
  app/              # Next.js routes, pages, and API handlers
  components/       # UI components (YouTubePlayer, ChatPanel, TranscriptPanel, …)
  hooks/            # useChatStream — shared conversation + SSE lifecycle
  lib/
    chat/           # System prompt builder, history trimming, shared limits
    convex/         # Convex client, auth helpers, shared auth messages
    llm/            # LLM provider abstraction (OpenAI, Ollama, OpenRouter)
    voice/          # Speech API wrappers
    transcript-service.ts  # Single transcript sidecar client
convex/             # Schema, queries, mutations, actions, auth
tests/              # Unit, route, component, and Convex integration tests
transcript-service/ # Python FastAPI service for YouTube transcript extraction
docs/
  plans/            # Design documents
  feature.md        # Deferred features and cleanup backlog
  changelog.md      # Version history
```

## Architecture

```
User pastes YouTube URL
  → Next.js API route validates + fetches transcript via Python sidecar
  → Stores episode + transcript chunks in Convex

User watches video, pauses, asks question
  → Chat API loads transcript chunks up to the pause timestamp
  → Builds system prompt (stable transcript prefix first, volatile context last)
  → Trims replayed history to a character budget
  → Streams LLM response via SSE
  → Persists messages in Convex for session durability
```

### Key Design Decisions

- **Full transcript context** — the entire transcript up to the pause point is sent to the LLM, not just a summary or nearby chunks
- **Prompt caching is load-bearing** — providers cache on an exact prefix, so the system prompt emits the *stable* transcript first and the *volatile* timestamp/excerpt/rules last. Putting the timestamp first invalidated the entire cache on every message.
- **Bounded history** — conversation history is trimmed to a character budget (newest turns kept), because replaying full history on top of a full transcript makes each turn quadratically more expensive.
- **Identity from tokens, never arguments** — every user-scoped Convex function checks ownership of the episode/conversation/podcaster.
- **Per-session persistence** — conversations are stored in Convex within a session but don't persist across videos
- **Provider-agnostic** — swap LLM providers via environment variable
- **Paged transcript** — the watch page fetches transcript chunks on demand; it never downloads a whole episode up front

## Future Vision

- Per-creator AI profiles that grow richer across episodes
- Cross-episode memory and knowledge accumulation
- Cloud TTS / STT for voice mode
- Semantic retrieval for large transcript catalogs
- Background ingestion jobs with progress
- Shared (Redis) rate-limit store for multi-instance deploys

See `docs/feature.md` for the full backlog.
