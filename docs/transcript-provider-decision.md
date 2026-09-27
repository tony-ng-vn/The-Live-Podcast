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
