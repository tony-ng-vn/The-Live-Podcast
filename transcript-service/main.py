"""
Transcript microservice — wraps youtube-transcript-api for The Live Podcast.

Start: uvicorn main:app --host 127.0.0.1 --port 8765 --reload
Or:    npm run transcript:dev
"""

import re

from fastapi import FastAPI, HTTPException
from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)

# `CouldNotRetrieveTranscript` only lives in a private module and has moved
# between releases. Import defensively so a library update cannot take the
# whole service down at import time.
try:  # pragma: no cover - depends on installed library layout
    from youtube_transcript_api._errors import CouldNotRetrieveTranscript
except ImportError:  # pragma: no cover
    CouldNotRetrieveTranscript = None

app = FastAPI(title="Transcript Service", version="1.0.0")

# Prefer English transcripts; fall back to any available language.
PREFERRED_LANGUAGES = ["en", "en-US", "en-GB", "en-CA", "en-AU"]

_VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# Single shared instance (thread-safe for reads)
_api = YouTubeTranscriptApi()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/transcript/{video_id}")
async def get_transcript(video_id: str) -> dict:
    """
    Returns transcript segments for the given YouTube video ID.

    Response shape:
        {
          "videoId": "...",
          "segments": [
            {"text": "...", "start": 0.0, "duration": 3.5},
            ...
          ]
        }
    """
    if not video_id or not _VIDEO_ID_RE.fullmatch(video_id):
        raise HTTPException(status_code=400, detail=f"Invalid YouTube video ID: {video_id!r}")

    try:
        # Try preferred languages first, then fall back to whatever is
        # available — deterministically, so the same video always resolves to
        # the same language track.
        try:
            fetched = _api.fetch(video_id, languages=PREFERRED_LANGUAGES)
        except NoTranscriptFound:
            available = list(_api.list(video_id))
            if not available:
                raise
            transcript = _pick_transcript(available)
            fetched = transcript.fetch()

        return {
            "videoId": video_id,
            "segments": [
                {
                    "text": s.text,
                    "start": s.start,
                    "duration": s.duration,
                }
                for s in fetched
            ],
        }

    except TranscriptsDisabled as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Transcripts are disabled for video {video_id}",
        ) from exc
    except NoTranscriptFound as exc:
        raise HTTPException(
            status_code=404,
            detail=f"No transcript found for video {video_id}. It may have no captions.",
        ) from exc
    except VideoUnavailable as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Video {video_id} is unavailable or does not exist",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        if CouldNotRetrieveTranscript is not None and isinstance(
            exc, CouldNotRetrieveTranscript
        ):
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _pick_transcript(available: list) -> object:
    """Choose a transcript track deterministically.

    Prefers English variants, then manually authored tracks (higher quality
    than auto-generated), then the language code, so repeated calls for the
    same video return the same track.
    """
    def sort_key(transcript: object) -> tuple:
        language = getattr(transcript, "language_code", "") or ""
        is_english = 0 if language.lower().startswith("en") else 1
        is_generated = 1 if getattr(transcript, "is_generated", False) else 0
        return (is_english, is_generated, language)

    return min(available, key=sort_key)
