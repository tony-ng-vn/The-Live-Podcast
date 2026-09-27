# The Live Podcast

An interactive app that lets you talk to any YouTube video in real time.
Paste a URL, watch the video, pause when something is unclear or interesting, and ask a question.
The AI answers with awareness of what has been discussed up to that moment.

## Problem

1. Asking an AI about a video currently means copying the transcript into ChatGPT.
2. Pasting the full transcript gives the AI material from later in the video and makes it hard to focus on what matters at the pause point.

## How It Works

1. Paste a YouTube URL to fetch and store its transcript.
2. Watch the video
3. Pause at any point and click "Jump In"
4. Ask a question via text chat
5. Get a contextually aware answer anchored to what was just being discussed
6. Chat as long as you want, then hit "Resume" to continue watching.

The AI has general knowledge plus the full context of what's been discussed up to your pause point. It responds conversationally, like a knowledgeable friend who watched the video with you.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 4
- **Data layer:** Convex
- **Auth:** Clerk
- **LLM:** Provider-agnostic (OpenAI, Ollama, or any OpenAI-compatible API)
- **Transcript:** Local Python service (youtube-transcript-api), with SerpApi for cloud hosting

## Setup

```bash
npm install
cp .env.example .env
```

Fill in your `.env` with:
- A working Convex development deployment URL (`NEXT_PUBLIC_CONVEX_URL`)
- Real Clerk development keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)
- LLM provider config (`LLM_PROVIDER`, API keys for your chosen provider)
- Transcript service URL (`TRANSCRIPT_SERVICE_URL`, defaults to `http://127.0.0.1:8765`)

The example values are placeholders and will not start the app.
`npm run dev` checks the Clerk key format and Convex URL before Next.js starts.
This format check cannot confirm that the services accept your keys or that the Convex deployment is active.

### Find server errors

The app shows a short retry message to viewers when a service fails.
During local development, the server writes the technical details to the ignored file `logs/app-errors.jsonl`.
Each JSON line has a timestamp, source, error ID, message, and stack.
To inspect the latest local records, run:

```bash
tail -n 20 logs/app-errors.jsonl
```

On Vercel, the server emits the same record with the `[app-error]` prefix.
To find production records through the CLI, run:

```bash
vercel logs --environment production --level error --query '[app-error]' --no-branch
```

Vercel's Hobby plan keeps runtime logs for one hour.
A longer history will need a separate error storage service before production use.

### Start the dev stack

```bash
npm run dev:all
```

This command starts Convex, the Python transcript service, and Next.js together.
It creates a local Python environment and installs transcript dependencies on the first run or when `transcript-service/requirements.txt` changes.
Python 3.11 or newer must be installed before the first run.
Press Ctrl+C to stop all three services.
The command checks Clerk and Convex settings before it starts any service.
It still needs a working Convex deployment and real Clerk keys.

If you run the transcript service on a different host or port, update
`TRANSCRIPT_SERVICE_URL` in `.env` before ingesting episodes.
For cloud hosting, set `TRANSCRIPT_PROVIDER=serpapi` and add `SERPAPI_API_KEY` as a server-side secret.
See [the transcript provider decision](docs/transcript-provider-decision.md) for the reason and the plan to return to one source.

## Testing

```bash
npm test                # Run test suite (vitest)
npx tsc --noEmit        # Type check
npx eslint .            # Lint
npm run build           # Full build
```

NBrain webhook test: README changes should refresh the managed Repo Guide.
NBrain webhook test 2: repo-scoped README changes should update only this repo guide.

## Project Structure

```
src/
  app/              # Next.js routes, pages, and API handlers
  components/       # UI components (YouTubePlayer, ChatPanel, etc.)
  lib/
    chat/           # System prompt builder
    convex/         # Convex client setup
    llm/            # LLM provider abstraction (OpenAI, Ollama)
    voice/          # Speech API wrappers (future: voice mode)
convex/             # Convex schema, queries, mutations, and actions
tests/              # API and integration test coverage
transcript-service/ # Python FastAPI service for YouTube transcript extraction
docs/
  plans/            # Design documents
  feature.md        # Deferred features and cleanup backlog
  changelog.md      # Version history
```

## Architecture

```
User pastes YouTube URL
  -> Next.js API route validates and fetches transcript via Python sidecar
  -> Stores episode and transcript chunks in Convex

User watches video, pauses, asks question
  -> Chat API loads transcript chunks up to pause timestamp
  -> Builds system prompt with transcript and response rules
  -> Streams LLM response via SSE
  -> Persists messages in Convex for session durability
```

### Key Design Decisions

- **Full transcript context.** The LLM receives transcript text up to the pause point.
- **Prompt caching.** The transcript is a stable system prompt prefix when the provider supports caching.
- **Per-session persistence.** Convex stores conversations within a session.
- **Provider choice.** An environment variable selects the LLM provider.

## Future Vision

- Per-creator AI profiles that grow richer across episodes
- Cross-episode memory and knowledge accumulation
- Voice mode for spoken conversations
- Semantic retrieval for large transcript catalogs
- Advanced context management (summarization, RAG, hybrid approaches)

See `docs/feature.md` for the full backlog.

NBrain DeepWiki demo note: the README remains the primary entry point for generated repo documentation.

NBrain rendered-docs demo note: DeepWiki-backed Notion pages now preserve list and code block structure.
