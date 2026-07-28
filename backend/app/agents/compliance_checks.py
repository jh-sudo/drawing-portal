"""
compliance_checks.py — Deterministic regulatory compliance checks for water schematics.

Four checks:
    REG28      — Regulation 28: backflow prevention (check valve upstream of water heater)
    SEC221     — Handbook 2.2.1: mode of supply based on height of highest fitting above AMSL
    SEC721     — Handbook 7.2.1: Mandatory Water Efficiency Labelling Scheme (MWELS) compliance
    TANK_PUMP  — Tank / pump installation requirements (PUB / SS 245 / SS 636)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
from app.agents.graph_utils import build_adjacency
from app.agents.backflow_assembly import bfs_find, check_assembly_order


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class CheckResult:
    check_id: str                         # "REG28", "SEC221", "SEC721"
    title: str
    status: str                           # "PASS" | "FAIL" | "WARN" | "SKIP"
    summary: str                          # one-sentence verdict
    detail: list[str]                     # bullet-point details
    table: list[dict] | None = None       # WELS rows for check3; None otherwise
    elements_of_interest: list[dict] = field(default_factory=list)
    # Each entry: {element_id, label, color}  — canvas_x/y resolved by caller
    issues: list[dict] = field(default_factory=list)
    # One entry per individually FAIL/WARN sub-condition, for reports that need
    # a row per issue rather than per check.
    # Each entry: {status: "FAIL"|"WARN", text: str, element_ids: list[str]}


# ---------------------------------------------------------------------------
# MWELS lookup table (Handbook 7.2.1, confirmed from PDF)
# ---------------------------------------------------------------------------

MWELS: dict[str, dict] = {
    "shower_tap": {
        "name": "Shower Tap & Mixer",
        "unit": "L/min",
        "2": 7.0,   # max flow at 2-tick
        "3": 5.0,   # max flow at 3-tick
    },
    "basin_tap": {
        "name": "Basin Tap & Mixer",
        "unit": "L/min",
        "2": 4.0,
        "3": 2.0,
    },
    "sink_tap": {
        "name": "Sink/Bib Tap & Mixer",
        "unit": "L/min",
        "2": 6.0,
        "3": 4.0,
    },
    "dual_flushing_cistern": {
        "name": "Dual-Flush Cistern",
        "unit": "L/flush",
        "2": 4.0,
        "3": 3.5,
    },
    "urinal_flush": {
        "name": "Urinal Flush Valve",
        "unit": "L/flush",
        "2": 1.0,
        "3": 0.5,
    },
    "water_closet": {
        "name": "WC Flush Valve",
        "unit": "L/flush",
        "2": 4.0,
        "3": 3.5,
    },
    # Appliances — PUB "Water Efficiency Rating & Requirements" (1 Dec 2021) covers these
    # under a wider 1-4 tick scale (vs. the 2-3 tick scale above). Values are each tier's
    # upper bound (e.g. washing machine 2-tick is ">9 to 12 litres/kg" -> 12.0).
    "washing_machine": {
        "name": "Clothes Washing Machine",
        "unit": "L/kg",
        # No 1-tick tier exists for washing machines (rated NA below 2-tick).
        "2": 12.0,
        "3": 9.0,
        "4": 6.0,
    },
    "dishwasher": {
        "name": "Dishwasher",
        "unit": "L/place setting",
        "1": 1.5,
        "2": 1.2,
        "3": 0.9,
        "4": 0.6,
    },
}

# Flow-rate fittings (vs. flush-volume fittings) — used for demand summation
FLOW_RATE_FITTING_IDS = {"shower_tap", "basin_tap", "sink_tap"}

# Fittings genuinely not subject to MWELS (no tick rating table exists for them) —
# they still require a Section 6 double check valve for backflow, but that's a separate
# concern from water efficiency labelling. washing_machine and dishwasher used to be
# listed here too, but PUB's "Water Efficiency Rating & Requirements" (1 Dec 2021)
# confirms both ARE MWELS-graded appliances (see the MWELS table above) — they need
# both a declared tick rating AND a check valve, not one or the other.
NON_MWELS_FITTING_IDS = {"water_dispenser", "landscape_tap"}


# Design demand (L/s) for network solver — use 2-tick max converted to L/s
MWELS_DEMAND_LPS: dict[str, float] = {
    "shower_tap":            7.0 / 60,
    "basin_tap":             4.0 / 60,
    "sink_tap":              6.0 / 60,
    "dual_flushing_cistern": 4.0 / 60,   # flush volume / assumed 1 min flush cycle
    "urinal_flush":          1.0 / 60,
    "water_closet":          4.0 / 60,
    # Section 6 appliance fittings — design demand estimates
    "dishwasher":            12.0 / 60,
    "water_dispenser":       3.0 / 60,
    "washing_machine":       12.0 / 60,
    "landscape_tap":         9.0 / 60,
}
DEFAULT_DEMAND_LPS = 0.1   # fallback if fitting type unknown


# ---------------------------------------------------------------------------
# Check 1 — Regulation 28: backflow prevention
# ---------------------------------------------------------------------------

def check_backflow_prevention(metadata: dict[str, Any], adj: dict[str, set[str]] | None = None) -> CheckResult:
    """
    Reg 28(1) + SS636 §6.4/6.5: Backflow prevention for all at-risk elements.

    - Water heater      → check valve required (Reg 28(1))
    - §6.4 appliances   → check valve required (dishwasher, washing machine,
                          water dispenser, landscape tap)
    - §6.5 bidet spray  → vacuum breaker required

    Uses BFS over the topology graph (direction-agnostic) so the check works
    regardless of how symbols are rotated or oriented on the canvas.

    `adj` may be passed in as a pre-built adjacency graph (built once per
    request in evaluate.py) to avoid rebuilding it for every check; if
    omitted, it's built from `metadata` here.
    """
    elements: list[dict] = metadata.get("elements", [])
    pipes: list[dict] = metadata.get("pipes", [])

    elem_by_id: dict[str, dict] = {e["id"]: e for e in elements}

    adjacency = adj if adj is not None else build_adjacency(elements, pipes)

    # backflow_requirement is exported by the frontend — single source of truth for which elements need protection.
    risk_elements = [
        e for e in elements
        if e.get("backflow_requirement") in ("check_valve", "vacuum_breaker")
    ]

    if not risk_elements:
        return CheckResult(
            check_id="REG28",
            title="Backflow Prevention",
            status="SKIP",
            summary="No backflow-risk elements found in schematic.",
            detail=["Add a water heater, appliance fitting, or bidet spray to enable this check."],
        )

    all_pass = True
    has_advisory = False
    details: list[str] = []
    elements_of_interest: list[dict] = []
    issues: list[dict] = []

    for el in risk_elements:
        el_id = el["id"]
        el_name = el.get("symbol_name", el.get("symbol_id", "Element"))
        sym_id = el.get("symbol_id", "")

        if el.get("backflow_requirement") == "vacuum_breaker":
            # §6.5: needs check_valve upstream of vacuum_breaker (inlet → cv → vb → bidet_spray)
            result = check_assembly_order(
                el_id, adjacency, elem_by_id,
                outer_type="check_valve", inner_type="vacuum_breaker",
            )
            cv_id, cv_hops = result.outer_id, result.outer_hops
            vb_id, vb_hops = result.inner_id, result.inner_hops

            if result.reason == "missing_both":
                all_pass = False
                text = (
                    f"{el_name}: No vacuum breaker or check valve found — "
                    "SS636 §6.5 requires a vacuum breaker + check valve assembly on all bidet spray connections."
                )
                details.append(f"✗ {text}")
                elements_of_interest.append({"element_id": el_id, "label": f"{el_name} — missing assembly!", "color": "red"})
                issues.append({"status": "FAIL", "text": text, "element_ids": [el_id]})
            elif result.reason == "missing_inner":
                all_pass = False
                text = (
                    f"{el_name}: No vacuum breaker found — "
                    "SS636 §6.5 requires a vacuum breaker upstream of the bidet spray connection."
                )
                details.append(f"✗ {text}")
                elements_of_interest.append({"element_id": el_id, "label": f"{el_name} — missing vacuum breaker!", "color": "red"})
                issues.append({"status": "FAIL", "text": text, "element_ids": [el_id]})
            elif result.reason == "missing_outer":
                all_pass = False
                text = (
                    f"{el_name}: Vacuum breaker found but no check valve — "
                    "SS636 §6.5 requires both a vacuum breaker AND check valve (inlet → CV → VB → bidet spray)."
                )
                details.append(f"✗ {text}")
                elements_of_interest.append({"element_id": el_id, "label": f"{el_name} — missing check valve!", "color": "red"})
                issues.append({"status": "FAIL", "text": text, "element_ids": [el_id]})
            elif result.reason == "wrong_order":
                # check_valve is not strictly farther from the bidet spray than vacuum_breaker —
                # wrong order (or tied hop-count, which can't be proven compliant).
                all_pass = False
                text = (
                    f"{el_name}: Assembly order incorrect (check valve {cv_hops} hop(s), vacuum breaker {vb_hops} hop(s)). "
                    "Correct order: inlet → check valve → vacuum breaker → bidet spray."
                )
                details.append(f"✗ {text}")
                elements_of_interest.append({"element_id": el_id, "label": f"{el_name} — wrong assembly order!", "color": "red"})
                if vb_id:
                    elements_of_interest.append({"element_id": vb_id, "label": "Vacuum Breaker — move upstream of check valve", "color": "orange"})
                if cv_id:
                    elements_of_interest.append({"element_id": cv_id, "label": "Check Valve — move upstream of vacuum breaker", "color": "orange"})
                issues.append({"status": "FAIL", "text": text, "element_ids": [i for i in (el_id, vb_id, cv_id) if i]})
            else:
                details.append(
                    f"✓ {el_name}: Vacuum breaker + check valve assembly in correct order "
                    f"(VB at {vb_hops} hop(s), CV at {cv_hops} hop(s)) — §6.5 satisfied."
                )
                elements_of_interest.append({"element_id": el_id, "label": el_name, "color": "blue"})
                if vb_id:
                    elements_of_interest.append({"element_id": vb_id, "label": "Vacuum Breaker", "color": "green"})
                if cv_id:
                    elements_of_interest.append({"element_id": cv_id, "label": "Check Valve", "color": "green"})
        else:
            # Reg 28(1) / §6.4: needs check_valve
            found_id, hops = bfs_find(adjacency, el_id, {"check_valve"}, elem_by_id)
            if sym_id == "water_heater":
                ref = "Reg 28(1)"
                missing_msg = "Reg 28(1) requires a check valve on the water heater inlet to prevent backflow."
            else:
                ref = "SS636 §6.4"
                missing_msg = f"SS636 §6.4 requires a double check valve upstream of {el_name}."

            if hops is not None:
                color = "blue" if hops == 1 else "orange"
                pos = "immediately upstream" if hops == 1 else f"{hops} hops upstream"
                details.append(f"✓ {el_name}: Check valve found {pos} — {ref} satisfied.")
                elements_of_interest.append({"element_id": el_id, "label": el_name, "color": color})
                if found_id:
                    elements_of_interest.append({"element_id": found_id, "label": "Check Valve", "color": "green"})
                if hops > 1 and sym_id == "water_heater":
                    has_advisory = True
                    details.append("  ⚠ Recommend moving check valve to directly before the water heater inlet.")
                    issues.append({
                        "status": "WARN",
                        "text": f"{el_name}: check valve found but not immediately adjacent — recommend moving it directly before the water heater inlet.",
                        "element_ids": [i for i in (el_id, found_id) if i],
                    })
            else:
                all_pass = False
                text = f"{el_name}: No check valve found upstream. {missing_msg}"
                details.append(f"✗ {text}")
                elements_of_interest.append({"element_id": el_id, "label": f"{el_name} — missing check valve!", "color": "red"})
                issues.append({"status": "FAIL", "text": text, "element_ids": [el_id]})

    if not all_pass and any("✗" in d for d in details):
        status = "FAIL"
        summary = "One or more backflow-risk elements are missing required protection — compliance violation."
    elif not all_pass or has_advisory:
        status = "WARN"
        summary = "Protection present but not immediately adjacent to all risk elements — review positioning."
    else:
        status = "PASS"
        summary = "All backflow-risk elements have the required protection — Reg 28(1) and SS636 §6.4/6.5 satisfied."

    return CheckResult(
        check_id="REG28",
        title="Backflow Prevention",
        status=status,
        summary=summary,
        detail=details,
        elements_of_interest=elements_of_interest,
        issues=issues,
    )


# ---------------------------------------------------------------------------
# Check 2 — Handbook 2.2.1: mode of supply
# ---------------------------------------------------------------------------

_SUPPLY_MODE_TABLE = [
    (25.0, "direct",        "Direct supply from PUB mains (≤ 25 m AMSL)."),
    (37.0, "indirect_tank", "Indirect supply via high-level water storage tank (> 25 m, ≤ 37 m AMSL)."),
    (float("inf"), "mode_c", "Indirect supply — Mode C: low-level transfer tank + pump to high-level tank (> 37 m AMSL)."),
]


def is_possibly_direct_supply(e: dict) -> bool:
    """True unless an element's supply_mode is confirmed 'indirect_supply'.

    metadataBuilder.ts's buildSupplyModes deliberately leaves supply_mode null
    for a water_fitting whose own ports disagree (e.g. a dual-supply fitting fed
    hot via a tank and cold via the mains) rather than guessing a single value —
    so null/ambiguous is treated the same as direct here, not skipped, matching
    the conservative "not confirmed indirect" reasoning check_supply_mode's own
    offending_fittings filter already uses below. Shared by any check that cares
    whether a fitting *might* be on direct supply (also used by
    highest_fitting_check.py) so the two conditions can't independently drift
    apart the way this codebase's duplicated constants have before (see e.g.
    derivePipe's history in canvasStore.ts)."""
    return e.get("supply_mode") != "indirect_supply"


def check_supply_mode(metadata: dict[str, Any]) -> CheckResult:
    """
    Handbook 2.2.1: Mode of supply based on the absolute AMSL elevation of the
    highest fitting.  Thresholds applied directly to the elevation_m values:
        ≤ 25 m  → direct supply from PUB mains
        > 25 m and ≤ 37 m → indirect via high-level water storage tank
        > 37 m  → Mode C (low-level transfer tank + pump)
    """
    elements: list[dict] = metadata.get("elements", [])

    all_elevations = [
        e["elevation_m"] for e in elements if e.get("elevation_m") is not None
    ]
    # Use node_type exported by the frontend — single source of truth for what counts as a fitting.
    # To add a new fitting symbol, add it to NODE_TYPE_MAP in metadataBuilder.ts with 'water_fitting'.
    fitting_elevations = [
        e["elevation_m"] for e in elements
        if e.get("node_type") == "water_fitting" and e.get("elevation_m") is not None
    ]

    if not all_elevations:
        return CheckResult(
            check_id="SEC221",
            title="Mode of Supply",
            status="SKIP",
            summary="No elevation data found in schematic.",
            detail=["Set the MRL bounds on the canvas to enable elevation-based checks."],
        )

    use_fitting = bool(fitting_elevations)
    elevations = fitting_elevations if use_fitting else all_elevations
    highest_m = max(elevations)
    lowest_m = min(elevations)
    elevation_source = "water fittings" if use_fitting else "all elements"

    # Determine required mode from absolute elevation
    required_mode = "mode_c"
    required_description = _SUPPLY_MODE_TABLE[-1][2]
    for threshold, mode_key, description in _SUPPLY_MODE_TABLE:
        if highest_m <= threshold:
            required_mode = mode_key
            required_description = description
            break

    # Check actual schematic configuration
    has_tank   = any(e.get("symbol_id") == "water_tank" for e in elements)
    has_pump   = any(e.get("symbol_id") == "pump" for e in elements)
    has_indirect = any(e.get("supply_mode") == "indirect_supply" for e in elements)

    # A tank existing somewhere in the drawing doesn't mean every high fitting is
    # actually fed from it — a fitting above the direct-supply limit but connected
    # straight to the mains (bypassing the tank) is its own violation, independent
    # of whether some other fitting in the drawing is correctly on indirect supply.
    DIRECT_SUPPLY_LIMIT_M = _SUPPLY_MODE_TABLE[0][0]
    offending_fittings = [
        e for e in elements
        if e.get("node_type") == "water_fitting"
        and e.get("elevation_m") is not None
        and e["elevation_m"] > DIRECT_SUPPLY_LIMIT_M
        and is_possibly_direct_supply(e)
    ]

    details: list[str] = [
        f"Highest fitting elevation: {highest_m:.1f} m AMSL (from {elevation_source}).",
        f"Lowest fitting elevation: {lowest_m:.1f} m AMSL.",
        f"Required supply mode: {required_description}",
        "",
        "Schematic configuration:",
        f"  Water tank present: {'Yes' if has_tank else 'No'}",
        f"  Pump present: {'Yes' if has_pump else 'No'}",
        f"  Indirect supply elements found: {'Yes' if has_indirect else 'No'}",
    ]

    elements_of_interest: list[dict] = []
    issues: list[dict] = []
    tanks = [e for e in elements if e.get("symbol_id") == "water_tank"]

    if required_mode == "direct":
        if has_indirect:
            status = "WARN"
            summary = f"Direct supply sufficient at {highest_m:.1f} m AMSL, but indirect supply elements detected — verify intent."
            details.append("⚠ Indirect supply elements found, but direct supply is sufficient at this elevation.")
            indirect_ids = [e["id"] for e in elements if e.get("supply_mode") == "indirect_supply"]
            issues.append({
                "status": "WARN",
                "text": "Indirect supply elements found, but direct supply is sufficient at this elevation — verify intent.",
                "element_ids": indirect_ids,
            })
        else:
            status = "PASS"
            summary = f"Direct supply from PUB mains is appropriate for highest fitting at {highest_m:.1f} m AMSL."

    elif required_mode == "indirect_tank":
        if not has_tank:
            status = "FAIL"
            summary = f"Highest fitting at {highest_m:.1f} m AMSL requires indirect supply via water storage tank — no tank found."
            details.append("✗ Water storage tank required but not present in schematic.")
            issues.append({
                "status": "FAIL",
                "text": f"Highest fitting at {highest_m:.1f} m AMSL requires indirect supply via water storage tank — no tank found.",
                "element_ids": [],
            })
        elif not has_indirect:
            status = "WARN"
            summary = f"Water tank present, but supply mode classification shows no indirect supply path — check connections."
            details.append("⚠ Water tank present, but no elements classified as indirect supply. Verify pipe connections.")
            issues.append({
                "status": "WARN",
                "text": "Water tank present, but no elements classified as indirect supply — verify pipe connections.",
                "element_ids": [t["id"] for t in tanks],
            })
        else:
            status = "PASS"
            summary = f"Indirect supply via water storage tank is correctly configured for {highest_m:.1f} m AMSL."

        # Additional check: tank inlet must be at or below 37 m AMSL (PUB requirement).
        # A waiver is required if the inlet exceeds 37 m — this must be handled administratively.
        for tank in tanks:
            tp = tank.get("tank_properties") or {}
            inlet_amsl = tp.get("inlet_pipe_m_amsl")
            tank_name = tank.get("symbol_name", "Water Tank")
            if inlet_amsl is None:
                details.append(
                    f"– [{tank_name}] Tank inlet level not set — cannot verify ≤ 37 m AMSL requirement. "
                    "Enter the inlet pipe level in Advanced Details."
                )
            elif inlet_amsl > 37.0:
                details.append(
                    f"✗ [{tank_name}] Tank inlet at {inlet_amsl:.1f} m AMSL exceeds the 37 m AMSL limit. "
                    "A PUB waiver is required for inlets above 37 m AMSL."
                )
                status = "FAIL"
                summary = (
                    f"[{tank_name}] Tank inlet at {inlet_amsl:.1f} m AMSL exceeds the 37 m AMSL maximum — "
                    "a PUB waiver is required."
                )
                issues.append({
                    "status": "FAIL",
                    "text": f"[{tank_name}] Tank inlet at {inlet_amsl:.1f} m AMSL exceeds the 37 m AMSL limit — a PUB waiver is required.",
                    "element_ids": [tank["id"]],
                })
            else:
                details.append(
                    f"✓ [{tank_name}] Tank inlet at {inlet_amsl:.1f} m AMSL is at or below 37 m AMSL — compliant."
                )

    else:  # mode_c
        missing = []
        if not has_tank:
            missing.append("water storage tank")
        if not has_pump:
            missing.append("pump")
        if missing:
            status = "FAIL"
            summary = f"Highest fitting at {highest_m:.1f} m AMSL requires Mode C supply — missing: {', '.join(missing)}."
            details.append(f"✗ Mode C requires a low-level transfer tank AND a pump. Missing: {', '.join(missing)}.")
            issues.append({
                "status": "FAIL",
                "text": f"Mode C supply required at {highest_m:.1f} m AMSL but missing: {', '.join(missing)}.",
                "element_ids": [],
            })
        else:
            status = "PASS"
            summary = f"Mode C supply (tank + pump) is present for {highest_m:.1f} m AMSL."

    # Per-fitting bypass check: catches a specific fitting wired straight to the
    # mains above the direct-supply limit even when the drawing has a tank and
    # other fittings are correctly on indirect supply elsewhere. Skipped when no
    # tank exists at all — that case is already reported above ("no tank found").
    if has_tank and offending_fittings:
        status = "FAIL"
        details.append("")
        details.append(f"Fittings above {DIRECT_SUPPLY_LIMIT_M:.0f} m AMSL bypassing the tank:")
        for e in offending_fittings:
            name = e.get("symbol_name", e.get("symbol_id", "Fitting"))
            elev = e["elevation_m"]
            reason = "connected directly to the mains" if e.get("supply_mode") == "direct_supply" else "not traceable to the tank's indirect side"
            issue_text = (
                f"{name} at {elev:.1f} m AMSL is above the {DIRECT_SUPPLY_LIMIT_M:.0f} m AMSL direct-supply "
                f"limit but is {reason} — it must be supplied from the water storage tank."
            )
            details.append(f"✗ {issue_text}")
            elements_of_interest.append({
                "element_id": e["id"],
                "label": f"{name} — on direct mains supply, not tank!",
                "color": "red",
            })
            issues.append({"status": "FAIL", "text": issue_text, "element_ids": [e["id"]]})
        summary = (
            f"{len(offending_fittings)} fitting(s) above {DIRECT_SUPPLY_LIMIT_M:.0f} m AMSL are supplied directly "
            "from the mains instead of via the water storage tank."
        )

    return CheckResult(
        check_id="SEC221",
        title="Mode of Supply",
        status=status,
        summary=summary,
        detail=details,
        elements_of_interest=elements_of_interest,
        issues=issues,
    )


# ---------------------------------------------------------------------------
# Check 3 — Handbook 7.2.1: MWELS water efficiency
# ---------------------------------------------------------------------------

def check_water_efficiency(metadata: dict[str, Any]) -> CheckResult:
    """
    Handbook 7.2.1: All water fittings must be labelled under PUB's
    Mandatory Water Efficiency Labelling Scheme (MWELS).
    Minimum 2-tick rating required (from 1 April 2019).

    Covers both the generic water_fittings symbol and dedicated fixture
    symbols (shower_head, wash_basin_rectangular, water_closet, etc.).
    """
    elements: list[dict] = metadata.get("elements", [])

    # fitting_type is exported by the frontend for all MWELS-relevant fixtures (FIXTURE_MWELS_CATEGORY).
    # Elements without fitting_type in the export are not subject to MWELS.
    mwels_els = [e for e in elements if "fitting_type" in e]

    if not mwels_els:
        return CheckResult(
            check_id="SEC721",
            title="Water Efficiency (MWELS)",
            status="SKIP",
            summary="No water fittings found in schematic.",
            detail=["Add water fittings (taps, WC, showers, etc.) to the schematic to enable this check."],
        )

    rows: list[dict] = []
    issues: list[dict] = []
    any_fail = False
    any_missing_data = False
    any_undeclared = False   # tick rating never set at all — treated as non-compliant, not just a warning
    missing_data_count = 0   # rows needing user input — excludes "not subject to MWELS" appliance rows
    total_flow_lpm = 0.0

    for el in mwels_els:
        el_id   = el["id"]
        sym_id  = el.get("symbol_id", "")

        fitting_type = el.get("fitting_type")

        ticks = el.get("efficiency_rating")

        # Appliance fittings (Section 6) are not MWELS-rated — skip
        if fitting_type in NON_MWELS_FITTING_IDS:
            rows.append({
                "element_id": el_id,
                "name": fitting_type.replace("_", " ").title() if fitting_type else "Appliance",
                "ticks": None,
                "design_flow": None,
                "unit": "—",
                "compliant": None,
                "note": "Not subject to MWELS — appliance fitting (Section 6 check valve required instead).",
            })
            continue

        symbol_name = el.get("symbol_name", sym_id.replace("_", " ").title())

        # Missing fitting type (ambiguous fixture with no user selection yet)
        if fitting_type is None:
            any_missing_data = True
            missing_data_count += 1
            rows.append({
                "element_id": el_id,
                "name": symbol_name,
                "ticks": None,
                "design_flow": None,
                "unit": "—",
                "compliant": None,
                "note": f"Click [{symbol_name}] on the canvas to select its fitting type, then re-export.",
            })
            issues.append({
                "status": "WARN",
                "text": f"{symbol_name}: fitting type not set — click the fixture on the canvas to select its fitting type.",
                "element_ids": [el_id],
            })
            continue

        # Missing tick rating — no MWELS label declared at all. Handbook 7.2.1 requires every
        # fitting to carry a declared >=2-tick label, so "undeclared" is non-compliant, not
        # merely incomplete data — it fails the check rather than just warning.
        if ticks is None:
            any_missing_data = True
            any_undeclared = True
            missing_data_count += 1
            rows.append({
                "element_id": el_id,
                "name": symbol_name,
                "ticks": None,
                "design_flow": None,
                "unit": "—",
                "compliant": None,
                "note": f"Click [{symbol_name}] on the canvas to set its MWELS tick rating — undeclared fittings fail this check.",
            })
            issues.append({
                "status": "FAIL",
                "text": f"{symbol_name}: no MWELS tick rating declared — undeclared fittings cannot be confirmed compliant (PUB, from 1 Apr 2019).",
                "element_ids": [el_id],
            })
            continue

        mwels_entry = MWELS.get(fitting_type)
        if mwels_entry is None:
            any_missing_data = True
            missing_data_count += 1
            rows.append({
                "element_id": el_id,
                "name": symbol_name,
                "ticks": ticks,
                "design_flow": None,
                "unit": "—",
                "compliant": None,
                "note": f"Fitting type '{fitting_type}' not in MWELS table.",
            })
            continue

        tick_key = str(ticks)
        if tick_key not in mwels_entry:
            # No declared figure for this exact tick count (e.g. an under-rated
            # 1-tick fitting where MWELS only defines 2/3-tick tiers) — fall back
            # to the least-efficient (highest-flow) tier actually present in this
            # entry, rather than assuming "2" always exists. Using the worst
            # defined tier is the closest available approximation to the true
            # (undefined, and necessarily worse) design flow for an under-rated
            # fitting, and avoids a KeyError for any MWELS entry that doesn't
            # happen to define a "2" tier.
            numeric_tiers = [k for k in mwels_entry if k.isdigit()]
            tick_key = min(numeric_tiers, key=int)
        design_flow = mwels_entry[tick_key]
        compliant = ticks >= 2

        if not compliant:
            any_fail = True
            issues.append({
                "status": "FAIL",
                "text": f"{mwels_entry['name']}: {ticks} tick(s) — minimum 2 required (PUB, from 1 Apr 2019).",
                "element_ids": [el_id],
            })

        if fitting_type in FLOW_RATE_FITTING_IDS:
            total_flow_lpm += design_flow

        rows.append({
            "element_id": el_id,
            "name": mwels_entry["name"],
            "ticks": ticks,
            "design_flow": design_flow,
            "unit": mwels_entry["unit"],
            "compliant": compliant,
            "note": None,
        })

    # Build details list
    compliant_count = sum(1 for r in rows if r.get("compliant") is True)
    non_compliant   = [r for r in rows if r.get("compliant") is False]

    details: list[str] = [
        f"Total MWELS fittings: {len(mwels_els)}",
        f"Compliant (≥ 2 ticks): {compliant_count}",
    ]
    if non_compliant:
        details.append(f"Non-compliant (< 2 ticks): {len(non_compliant)}")
        for r in non_compliant:
            details.append(f"  ✗ {r['name']}: {r['ticks']} tick(s) — minimum 2 required (PUB, from 1 Apr 2019).")
    if missing_data_count:
        details.append(
            f"Missing data: {missing_data_count} fitting(s) — click each fixture on the canvas to set its MWELS tick rating."
        )
    if total_flow_lpm > 0:
        details.append(f"Total design flow demand (flow-rate fittings): {total_flow_lpm:.1f} L/min")
    details.append("")
    details.append("Reference: PUB Handbook on Application for Water Supply 2022, Section 7.2.1.")

    if any_fail or any_undeclared:
        status = "FAIL"
        if any_fail and any_undeclared:
            summary = "One or more water fittings are below the minimum 2-tick MWELS rating or have no rating declared."
        elif any_fail:
            summary = "One or more water fittings do not meet the minimum 2-tick MWELS rating."
        else:
            summary = "One or more water fittings have no MWELS tick rating declared — undeclared fittings cannot be confirmed compliant."
    elif any_missing_data and compliant_count == 0:
        status = "WARN"
        summary = "Water fittings found but tick ratings not set — click each fixture to configure, then re-export."
    elif any_missing_data:
        status = "WARN"
        summary = "Some fittings compliant, but others are missing tick rating data — check incomplete."
    else:
        status = "PASS"
        summary = f"All {compliant_count} water fitting(s) meet the MWELS 2-tick minimum requirement."

    return CheckResult(
        check_id="SEC721",
        title="Water Efficiency (MWELS)",
        status=status,
        summary=summary,
        detail=details,
        table=rows,
        issues=issues,
    )
