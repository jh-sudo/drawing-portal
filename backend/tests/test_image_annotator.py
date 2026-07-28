"""
test_image_annotator.py — pixel-count guard on annotate_schematic.

Regression for the "no dimension guard before decoding uploaded images"
finding: a large/decompression-bomb-style image previously reached
Image.convert("RGB") (full pixel decode) unconditionally.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.services import image_annotator
from app.services.image_annotator import ImageTooLargeError, annotate_schematic


def _jpeg_bytes(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="JPEG")
    return buf.getvalue()


def test_normal_size_image_annotates_successfully():
    result = annotate_schematic(
        image_bytes=_jpeg_bytes(200, 150),
        annotated_elements=[{"canvas_x": 10, "canvas_y": 10, "label": "A", "color": "red"}],
        canvas_width=200,
        canvas_height=150,
    )
    assert isinstance(result, str) and len(result) > 0


def test_oversized_image_rejected_before_full_decode(monkeypatch):
    # Patch the pixel cap low so the test doesn't need to construct/encode an
    # actual 40-megapixel image — dimensions alone (100x100=10000) are enough
    # to exceed a lowered cap.
    monkeypatch.setattr(image_annotator, "MAX_ANNOTATE_PIXELS", 5_000)
    with pytest.raises(ImageTooLargeError):
        annotate_schematic(
            image_bytes=_jpeg_bytes(100, 100),
            annotated_elements=[],
            canvas_width=100,
            canvas_height=100,
        )
