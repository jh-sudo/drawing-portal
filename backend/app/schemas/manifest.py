import json
from pathlib import Path


def read_manifest(manifest_path: Path) -> dict:
    if not manifest_path.exists():
        return {"version": 1, "symbols": []}
    with open(manifest_path, "r") as f:
        return json.load(f)


def find_symbol(manifest: dict, symbol_id: str) -> dict | None:
    for sym in manifest.get("symbols", []):
        if sym["id"] == symbol_id:
            return sym
    return None
