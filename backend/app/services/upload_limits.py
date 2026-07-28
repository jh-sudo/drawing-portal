"""upload_limits.py — Shared upload-size guard for routers that accept file uploads.

Mirrors symbol_service.py's MAX_FILE_SIZE pattern (read fully, then check length)
for endpoints that don't need a stricter cap. Since FastAPI/Starlette buffers
UploadFile content in memory (spooling to disk only past its internal threshold),
this doesn't prevent the read itself from happening, but it does reject anything
over the cap before the bytes are handed off to further processing (image
decoding, docx embedding, etc.) and gives the client a clear 413 instead of a
silent memory spike.
"""

from __future__ import annotations

from fastapi import HTTPException

# Schematic photos/crops are camera/screenshot captures, larger than the 2MB
# symbol-upload cap but still bounded.
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_CROPS_PER_EXPORT = 50


def check_upload_size(content: bytes, label: str) -> None:
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"{label} exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)}MB limit")
