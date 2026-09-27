"""
Transcript service for The Live Podcast. Uses youtube-transcript-api.

Start: uvicorn main:app --host 127.0.0.1 --port 8765 --reload
Or:    npm run transcript:dev
"""

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)
from youtube_transcript_api._errors import CouldNotRetrieveTranscript

app = FastAPI(title="Transcript Service", version="1.0.0")

# Prefer English transcripts; fall back to any available language.
PREFERRED_LANGUAGES = ["en", "en-US", "en-GB", "en-CA", "en-AU"]

# Single shared instance (thread-safe for reads)
_api = YouTubeTranscriptApi()


def require_service_token(token: str | None = Header(default=None, alias="X-Transcript-Token")) -> None:
    expected = os.environ.get("TRANSCRIPT_SERVICE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="Transcript service token is not configured")
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/transcript/{video_id}", dependencies=[Depends(require_service_token)])
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
    if not video_id or len(video_id) != 11:
        raise HTTPException(status_code=400, detail=f"Invalid YouTube video ID: {video_id!r}")

    try:
        # Try preferred languages; if none match, fall back to the first available one.
        try:
            fetched = _api.fetch(video_id, languages=PREFERRED_LANGUAGES)
        except NoTranscriptFound:
            transcript_list = _api.list(video_id)
            transcript = next(iter(transcript_list))
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

    except TranscriptsDisabled:
        raise HTTPException(
            status_code=404,
            detail=f"Transcripts are disabled for video {video_id}",
        )
    except NoTranscriptFound:
        raise HTTPException(
            status_code=404,
            detail=f"No transcript found for video {video_id}. It may have no captions.",
        )
    except VideoUnavailable:
        raise HTTPException(
            status_code=404,
            detail=f"Video {video_id} is unavailable or does not exist",
        )
    except CouldNotRetrieveTranscript as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
