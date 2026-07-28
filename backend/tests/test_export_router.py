"""
test_export_router.py — HTTP-boundary tests for POST /api/export/docx.

Covers the "corrupt crop image crashes the whole export" and "unbounded
crops/upload size" findings from the code review — every case here must
return a clean response or 4xx, never a 500.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.main import app
from app.services.upload_limits import MAX_CROPS_PER_EXPORT, MAX_UPLOAD_SIZE

client = TestClient(app)


def _manifest(rows):
    return {"manifest_json": json.dumps(rows)}


def test_export_with_no_rows_returns_200():
    r = client.post("/api/export/docx", data=_manifest([]))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


def test_export_with_valid_crop_image_returns_200():
    from PIL import Image
    import io as _io

    buf = _io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(buf, format="PNG")
    rows = [{"crop_index": 0, "status": "FAIL", "check_title": "Test", "check_id": "X", "text": "issue"}]
    r = client.post(
        "/api/export/docx",
        data=_manifest(rows),
        files={"crops": ("crop0.png", buf.getvalue(), "image/png")},
    )
    assert r.status_code == 200


def test_export_with_corrupt_crop_image_does_not_crash():
    """Regression: a corrupt/non-image crop file used to raise uncaught inside
    python-docx's add_picture, producing a 500 instead of a degraded row."""
    rows = [{"crop_index": 0, "status": "FAIL", "check_title": "Test", "check_id": "X", "text": "issue"}]
    r = client.post(
        "/api/export/docx",
        data=_manifest(rows),
        files={"crops": ("not_an_image.png", b"this is not image data", "image/png")},
    )
    assert r.status_code == 200


def test_export_invalid_manifest_json_returns_422():
    r = client.post("/api/export/docx", data={"manifest_json": "{bad json"})
    assert r.status_code == 422


def test_export_too_many_crops_rejected():
    files = [
        ("crops", (f"c{i}.png", b"x", "image/png"))
        for i in range(MAX_CROPS_PER_EXPORT + 1)
    ]
    r = client.post("/api/export/docx", data=_manifest([]), files=files)
    assert r.status_code == 413


def test_export_oversized_crop_rejected():
    oversized = b"x" * (MAX_UPLOAD_SIZE + 1)
    r = client.post(
        "/api/export/docx",
        data=_manifest([]),
        files={"crops": ("big.png", oversized, "image/png")},
    )
    assert r.status_code == 413
