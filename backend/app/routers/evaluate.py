"""
evaluate.py — POST /api/evaluate

Accepts a schematic metadata JSON + optional schematic JPG and runs:
    1. REG28   — backflow prevention check (check valve upstream of water heater)
    2. SEC221  — mode of supply based on height of highest fitting (Handbook 2.2.1)
    3. SEC721  — MWELS water efficiency rating compliance (Handbook 7.2.1)

Returns a structured JSON report rendered in the Draw tab's evaluation modal.
"""

from __future__ import annotations

import json
import traceback
from dataclasses import asdict

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.agents.compliance_checks import (
    check_backflow_prevention,
    check_supply_mode,
    check_water_efficiency,
)
from app.agents.graph_utils import build_adjacency
from app.agents.tank_pump_check import check_tank_pump_installation
from app.agents.long_bath_check import check_long_bath_installation
from app.agents.hot_water_contamination_check import check_hot_water_contamination
from app.agents.section3_pipe_check import check_section3_pipes
from app.agents.highest_fitting_check import check_highest_direct_supply_fitting
from app.services.image_annotator import annotate_schematic
from app.services.upload_limits import check_upload_size

router = APIRouter()


# ---------------------------------------------------------------------------
# Metadata validation
# ---------------------------------------------------------------------------

def _validate_metadata(metadata: dict) -> None:
    """Validate the shape of parsed metadata_json before it reaches the check
    functions, which index elements/pipes by "id" with no further guards."""
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=422, detail="metadata_json must be a JSON object.")

    elements = metadata.get("elements", [])
    if not isinstance(elements, list):
        raise HTTPException(status_code=422, detail="metadata.elements must be a list.")
    for i, el in enumerate(elements):
        if not isinstance(el, dict) or not el.get("id"):
            raise HTTPException(status_code=422, detail=f"metadata.elements[{i}] is missing a non-empty 'id' field.")

    pipes = metadata.get("pipes", [])
    if not isinstance(pipes, list):
        raise HTTPException(status_code=422, detail="metadata.pipes must be a list.")
    for i, pipe in enumerate(pipes):
        if not isinstance(pipe, dict) or not pipe.get("id"):
            raise HTTPException(status_code=422, detail=f"metadata.pipes[{i}] is missing a non-empty 'id' field.")

    canvas = metadata.get("canvas", {})
    if not isinstance(canvas, dict):
        raise HTTPException(status_code=422, detail="metadata.canvas must be an object.")
    for field in ("width_px", "height_px"):
        value = canvas.get(field)
        if value is not None:
            if not isinstance(value, (int, float)):
                raise HTTPException(status_code=422, detail=f"metadata.canvas.{field} must be a number.")
            if value <= 0:
                raise HTTPException(status_code=422, detail=f"metadata.canvas.{field} must be positive.")


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------

class EvaluateResponse(BaseModel):
    check1_backflow: dict
    check2_supply_mode: dict
    check3_water_efficiency: dict
    check4_tank_pump: dict
    check5_long_bath: dict
    check6_hot_water: dict
    check7_section3_pipes: dict
    check8_highest_fitting: dict
    annotated_image_b64: str | None = None


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------

@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate_schematic(
    metadata_json: str = Form(...),
    schematic_image: UploadFile | None = File(default=None),
) -> EvaluateResponse:
    """
    Run all compliance checks on a schematic metadata JSON.
    Optionally annotate the uploaded schematic JPG with element markers.
    """
    # Parse metadata
    try:
        metadata = json.loads(metadata_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON in metadata_json: {e}")

    _validate_metadata(metadata)

    elements: list[dict] = metadata.get("elements", [])
    pipes: list[dict] = metadata.get("pipes", [])
    canvas: dict = metadata.get("canvas", {})
    # _validate_metadata already rejects non-numeric width_px/height_px, but an
    # explicit `null` passes that check (it's a legitimate "not provided") and
    # still needs a default here rather than reaching int(None).
    canvas_w = int(canvas.get("width_px") or 1200)
    canvas_h = int(canvas.get("height_px") or 800)

    # Built once and shared by every check that needs topology (REG28, HOT_WATER,
    # TANK_PUMP) — they all previously rebuilt the identical O(n²) proximity graph.
    adjacency = build_adjacency(elements, pipes)

    # ── Run compliance checks ────────────────────────────────────────────────
    check1 = check_backflow_prevention(metadata, adjacency)
    check2 = check_supply_mode(metadata)
    check3 = check_water_efficiency(metadata)
    check4 = check_tank_pump_installation(metadata, adjacency)
    check5 = check_long_bath_installation(metadata)
    check6 = check_hot_water_contamination(metadata, adjacency)
    check7 = check_section3_pipes(metadata)
    check8 = check_highest_direct_supply_fitting(metadata)

    # ── Image annotation ─────────────────────────────────────────────────────
    annotated_image_b64: str | None = None

    if schematic_image is not None and check1.elements_of_interest:
        try:
            image_bytes: bytes | None = await schematic_image.read()
        except Exception:
            # Transport-level read failure (e.g. a truncated upload) — degrade to
            # no annotation rather than 500ing a request whose 8 compliance checks
            # already ran successfully above.
            traceback.print_exc()
            image_bytes = None

        if image_bytes is not None:
            check_upload_size(image_bytes, "schematic_image")  # intentionally not caught — a genuine 413 should propagate

            try:
                # Resolve canvas coordinates for each element of interest
                elem_by_id = {e["id"]: e for e in elements}
                annotated_elements: list[dict] = []
                for item in check1.elements_of_interest:
                    el = elem_by_id.get(item["element_id"])
                    if el:
                        pos = el.get("position", {})
                        annotated_elements.append({
                            "canvas_x": pos.get("canvas_x", 0),
                            "canvas_y": pos.get("canvas_y", 0),
                            "label": item["label"],
                            "color": item["color"],
                        })

                if annotated_elements:
                    annotated_image_b64 = annotate_schematic(
                        image_bytes=image_bytes,
                        annotated_elements=annotated_elements,
                        canvas_width=canvas_w,
                        canvas_height=canvas_h,
                    )
            except Exception:
                # Annotation failure is non-fatal — log and continue
                traceback.print_exc()

    return EvaluateResponse(
        check1_backflow=asdict(check1),
        check2_supply_mode=asdict(check2),
        check3_water_efficiency=asdict(check3),
        check4_tank_pump=asdict(check4),
        check5_long_bath=asdict(check5),
        check6_hot_water=asdict(check6),
        check7_section3_pipes=asdict(check7),
        check8_highest_fitting=asdict(check8),
        annotated_image_b64=annotated_image_b64,
    )
