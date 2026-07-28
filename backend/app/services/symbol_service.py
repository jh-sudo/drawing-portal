from pathlib import Path
from fastapi import HTTPException

from app.config import settings
from app.schemas.manifest import read_manifest, find_symbol


def get_symbol_file_path(symbol_id: str) -> Path:
    manifest = read_manifest(settings.manifest_path)
    sym = find_symbol(manifest, symbol_id)
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    path = settings.symbols_dir / sym["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Symbol file not found on disk")
    return path
