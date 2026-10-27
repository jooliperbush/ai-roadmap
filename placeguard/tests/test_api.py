"""The HTTP API end to end, with Celery in eager mode so the job runs inside the request."""

import importlib

import pytest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    d = tmp_path_factory.mktemp("api")
    mp = pytest.MonkeyPatch()
    mp.setenv("DATABASE_URL", f"sqlite:///{d}/test.db")
    mp.setenv("PLACEGUARD_STORAGE_ROOT", str(d / "blobs"))
    mp.setenv("PLACEGUARD_EAGER", "1")
    mp.setenv("PLACEGUARD_TRANSCRIBE", "0")
    mp.delenv("OPENAI_API_KEY", raising=False)
    mp.delenv("PLACEGUARD_LLM_API_KEY", raising=False)

    from placeguard.api import db, settings

    settings.get_settings.cache_clear()
    db._sessionmaker.cache_clear()
    from placeguard.api import worker

    importlib.reload(worker)
    from placeguard.api import app as app_module

    importlib.reload(app_module)
    from fastapi.testclient import TestClient

    with TestClient(app_module.app) as c:
        c.key = db.create_api_key("test")
        c.other_key = db.create_api_key("someone else")
        yield c
    mp.undo()
    settings.get_settings.cache_clear()
    db._sessionmaker.cache_clear()


def auth(key):
    return {"Authorization": f"Bearer {key}"}


def upload(client, path, kind, key=None):
    with open(path, "rb") as fh:
        r = client.post("/api/v1/uploads", data={"kind": kind}, files={"file": (path.name, fh)},
                        headers=auth(key or client.key))
    assert r.status_code == 201, r.text
    return r.json()["upload_id"]


def test_requires_a_valid_bearer_token(client):
    assert client.get("/api/v1/audit/jobs/job_x").status_code == 401
    assert client.get("/api/v1/audit/jobs/job_x", headers=auth("pg_wrong")).status_code == 401


def test_full_audit_over_http(client, assets):
    video = upload(client, assets / "video.mp4", "video")
    logo = upload(client, assets / "logo.png", "image")
    r = client.post("/api/v1/audit/jobs", headers=auth(client.key), json={
        "source": {"type": "upload", "upload_id": video},
        "brand": {"name": "Acme", "reference_image_ids": [logo], "competitors": ["Globex"]},
        "valuation": {"views": 250000, "base_cpm": 20},
        "requirements": {"min_clear_view_time": 3},
    })
    assert r.status_code == 202, r.text
    accepted = r.json()
    assert accepted["status"] == "queued" and accepted["links"]["self"].endswith(accepted["job_id"])

    job = client.get(accepted["links"]["self"], headers=auth(client.key)).json()
    assert job["status"] == "completed", job.get("error")
    assert job["progress"] == 1.0
    m = job["result"]["metrics"]
    assert m["total_screen_time"] == pytest.approx(8.0, abs=0.5)
    assert m["clear_view_time"] == pytest.approx(4.0, abs=0.5)
    assert job["result"]["emv"]["value"] > 0

    # Another account can neither read the job nor use these uploads.
    assert client.get(accepted["links"]["self"], headers=auth(client.other_key)).status_code == 404
    r = client.post("/api/v1/audit/jobs", headers=auth(client.other_key), json={
        "source": {"type": "upload", "upload_id": video},
        "brand": {"name": "Acme", "reference_image_ids": [logo]},
    })
    assert r.status_code == 422


def test_rejects_non_mp4_video_and_non_image_reference(client, assets, tmp_path):
    bogus = tmp_path / "notes.txt"
    bogus.write_text("not a video at all, just text")
    for kind in ("video", "image"):
        with open(bogus, "rb") as fh:
            r = client.post("/api/v1/uploads", data={"kind": kind}, files={"file": ("x", fh)}, headers=auth(client.key))
        assert r.status_code == 415


def test_validates_job_body(client, assets):
    logo = upload(client, assets / "logo.png", "image")
    bad = [
        {"source": {"type": "youtube", "url": "https://vimeo.com/123"}, "brand": {"name": "A", "reference_image_ids": [logo]}},
        {"source": {"type": "youtube", "url": "https://youtu.be/abc"}, "brand": {"name": "A", "reference_image_ids": []}},
        {"source": {"type": "youtube", "url": "https://youtu.be/abc"}, "brand": {"name": "A", "reference_image_ids": [logo] * 6}},
    ]
    for body in bad:
        assert client.post("/api/v1/audit/jobs", headers=auth(client.key), json=body).status_code == 422


def test_failed_job_reports_its_error(client, assets, monkeypatch):
    logo = upload(client, assets / "logo.png", "image")

    def boom(*a, **k):
        raise RuntimeError("video unavailable")

    monkeypatch.setattr("placeguard.api.worker.run_audit", boom)
    r = client.post("/api/v1/audit/jobs", headers=auth(client.key), json={
        "source": {"type": "youtube", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        "brand": {"name": "Acme", "reference_image_ids": [logo]},
    })
    job = client.get(r.json()["links"]["self"], headers=auth(client.key)).json()
    assert job["status"] == "failed" and "video unavailable" in job["error"]
