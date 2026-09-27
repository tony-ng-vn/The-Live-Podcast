from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

import main


@pytest.fixture(autouse=True)
def block_live_youtube(monkeypatch):
    def unexpected_fetch(*args, **kwargs):
        raise AssertionError("Authentication should run before YouTube fetch")

    monkeypatch.setattr(main._api, "fetch", unexpected_fetch)


def test_transcript_requires_a_configured_token(monkeypatch):
    monkeypatch.delenv("TRANSCRIPT_SERVICE_TOKEN", raising=False)

    response = TestClient(main.app).get("/transcript/5MgBikgcWnY")

    assert response.status_code == 503


def test_transcript_rejects_requests_without_the_shared_token(monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_SERVICE_TOKEN", "test-secret")

    response = TestClient(main.app).get("/transcript/5MgBikgcWnY")

    assert response.status_code == 401


def test_transcript_accepts_a_valid_shared_token(monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_SERVICE_TOKEN", "test-secret")
    monkeypatch.setattr(
        main._api,
        "fetch",
        lambda *args, **kwargs: [SimpleNamespace(text="Hello", start=0.0, duration=1.2)],
    )

    response = TestClient(main.app).get(
        "/transcript/5MgBikgcWnY",
        headers={"X-Transcript-Token": "test-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "videoId": "5MgBikgcWnY",
        "segments": [{"text": "Hello", "start": 0.0, "duration": 1.2}],
    }
