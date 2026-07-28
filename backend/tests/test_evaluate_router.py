"""
test_evaluate_router.py — HTTP-boundary tests for POST /api/evaluate.

Unlike the agents/*.py tests (pure function -> CheckResult), these exercise the
actual router: request parsing, _validate_metadata, and upload-size handling.
Covers the "malformed input crashes the whole endpoint" and "unbounded upload"
findings from the code review — every case here must return a clean 4xx, never
a 500.
"""

from __future__ import annotations

import json

from fastapi.datastructures import UploadFile
from fastapi.testclient import TestClient

from app.main import app
from app.services.upload_limits import MAX_UPLOAD_SIZE
from tests.helpers import el, meta

client = TestClient(app)


def _post(metadata: dict, files: dict | None = None):
    return client.post(
        "/api/evaluate",
        data={"metadata_json": json.dumps(metadata)},
        files=files,
    )


def test_valid_minimal_metadata_returns_200():
    r = _post(meta([]))
    assert r.status_code == 200
    body = r.json()
    assert "check1_backflow" in body


def test_invalid_json_returns_422_not_500():
    r = client.post("/api/evaluate", data={"metadata_json": "{not valid json"})
    assert r.status_code == 422


def test_canvas_not_an_object_returns_422_not_500():
    m = meta([])
    m["canvas"] = "not-an-object"
    r = _post(m)
    assert r.status_code == 422


def test_canvas_width_px_non_numeric_returns_422_not_500():
    """Regression: a string width_px used to reach int(...) unguarded and raise
    an uncaught ValueError (500) instead of a clean validation error."""
    m = meta([])
    m["canvas"] = {"width_px": "abc", "height_px": 800}
    r = _post(m)
    assert r.status_code == 422


def test_canvas_width_px_null_does_not_crash():
    """An explicit `null` passes the type check (it's a legitimate 'not set')
    but must still fall back to a default rather than reaching int(None)."""
    m = meta([])
    m["canvas"] = {"width_px": None, "height_px": None}
    r = _post(m)
    assert r.status_code == 200


def test_element_missing_id_returns_422():
    m = meta([{"symbol_id": "water_heater"}])  # no "id"
    r = _post(m)
    assert r.status_code == 422


def test_string_efficiency_rating_does_not_crash():
    """Regression: a string efficiency_rating used to reach `ticks >= 2`
    unguarded in check_water_efficiency and raise an uncaught TypeError (500)."""
    m = meta([el("s1", "shower_head", fitting_type="shower_tap", efficiency_rating="2")])
    r = _post(m)
    assert r.status_code == 200
    body = r.json()
    # Malformed rating is treated as undeclared -> FAILs cleanly, not a crash.
    assert body["check3_water_efficiency"]["status"] == "FAIL"


def test_oversized_schematic_image_rejected():
    """Only exercised when the check flags an element of interest (annotation
    only runs then) — use a bare water_heater with no protection so REG28/HOT_WATER
    flags it, which is what gates the image-read path in the router."""
    m = meta([el("h1", "water_heater", backflow_requirement="check_valve")])
    oversized = b"x" * (MAX_UPLOAD_SIZE + 1)
    r = _post(m, files={"schematic_image": ("big.jpg", oversized, "image/jpeg")})
    assert r.status_code == 413


def test_negative_canvas_width_px_returns_422_not_corrupted_annotation():
    """Regression: a negative width_px passed the numeric-type check and the
    `or 1200` fallback (only catches falsy values, not negatives), reaching
    image_annotator with a canvas_width that silently corrupts marker scaling
    instead of failing cleanly."""
    m = meta([])
    m["canvas"] = {"width_px": -50, "height_px": 800}
    r = _post(m)
    assert r.status_code == 422


def test_canvas_width_px_zero_returns_422():
    m = meta([])
    m["canvas"] = {"width_px": 0, "height_px": 800}
    r = _post(m)
    assert r.status_code == 422


def test_image_read_failure_degrades_gracefully_not_500(monkeypatch):
    """Regression: moving the image read outside the annotation try/except (so
    check_upload_size's 413 could propagate) also meant any other read failure
    -- e.g. a truncated upload -- became an uncaught 500 instead of a 200 with
    annotation simply skipped."""
    async def broken_read(self, size: int = -1):
        raise RuntimeError("simulated truncated upload")

    monkeypatch.setattr(UploadFile, "read", broken_read)

    m = meta([el("h1", "water_heater", backflow_requirement="check_valve")])
    r = _post(m, files={"schematic_image": ("photo.jpg", b"fake-bytes", "image/jpeg")})
    assert r.status_code == 200
    assert r.json()["annotated_image_b64"] is None
