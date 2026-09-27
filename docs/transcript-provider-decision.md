# Transcript provider decision

The local app uses `youtube-transcript-api` through its Python service.
The hosted app uses SerpApi's YouTube transcript endpoint because YouTube blocks requests from Vercel's cloud IPs.
A Vercel deployment of the Python service returned the library's IP-blocked error for a real video.

Both sources become the same list of captions with text, start offset, and duration in seconds before Convex stores them.
Chat and pause-point filtering use that stored format and do not depend on the transcript source.
SerpApi is a temporary production choice on its free tier of 250 successful searches per month.

Tony prefers one transcript source for local and production use in the future.
Maintaining two sources means testing two response formats and two sets of errors.
Revisit this when a reliable single source fits the budget and uptime needs.
A paid rotating residential proxy could let the existing Python service run from a cloud host.
A home-hosted service through Cloudflare Tunnel could use the current library without a proxy subscription, but adding videos would depend on that computer staying online.
Before switching, test timed captions, unavailable videos, languages, rate limits, and the pause-point boundary against real videos.

## Captions without end times

A production import on 2026-09-27 returned 208 SerpApi captions with `start_ms` and no `end_ms`.
The same response shape also appeared with `type=asr`.
The parser now uses the next cue's start as the current cue's completion boundary when an end is absent.
This is an approximation based on sequential cues, not an exact word completion time.
Explicit provider end times remain unchanged.
The final caption has no next cue, so it carries `requiresVideoEnd` and stays out of chat context until the player reports that the video ended.
The client sends the completed video duration, and the database checks that the pause timestamp reaches that duration before including the final caption.
No additional transcript provider or metadata request is needed.
Malformed text, negative times, non-finite times, and non-increasing cue starts still fail validation.
Future single-provider research should include exact end timing and overlapping captions, because timing quality affects the pause-point promise.
