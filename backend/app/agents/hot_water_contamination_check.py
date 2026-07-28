"""
hot_water_contamination_check.py — Section 6: Hot water / Contamination prevention.

Rules:
  6.1  Heat pump supply mode consistency — cold and hot supplies to fittings must be
       via the same mode (both direct or both indirect).
  6.2  Direct-supply heaters must be mains-pressure type — automated. Only two heater
       symbols exist (storage water heater = mains-pressure, instantaneous water
       heater), so any heater drawn on a direct-supply branch is one of the two
       SS636 §6.5.1/§6.5.2-compliant types by construction; no acknowledgment needed.
  6.3  Water heater protection assembly (graph check). Per the WSI Landed
       checklist: "installed with EITHER check valve and pressure relief
       valve assembly OR double check valve assembly" — i.e. PASS requires
       (check_valve AND pressure_relief_valve) OR (two check_valve elements
       in series, matching the same double-check-valve definition already
       used for §6.4 appliance assemblies). A single check valve alone
       (no PRV, not doubled) satisfies neither option.
  6.4  Double check valves for appliances (dishwasher, water_dispenser, washing_machine,
       landscape_tap) — graph check for adjacent check_valve.
  6.5  Bidet sprays — vacuum_breaker adjacent to each bidet element (graph check).
  6.6  Tanks/pumps not below sanitary pipes — LP/PE acknowledgment.
"""

from __future__ import annotations
from collections import Counter, defaultdict
from typing import Any
from app.agents.compliance_checks import CheckResult
from app.agents.graph_utils import build_adjacency
from app.agents.backflow_assembly import bfs_find as _bfs_find, check_assembly_order, DEFAULT_MAX_HOPS

# The only two heater symbols SS636 §6.5.1/§6.5.2 allow on direct (mains-pressure)
# supply — "water_heater" represents a mains-pressure storage heater, and
# "instantaneous_water_heater" an instantaneous unit. Any other heater type (e.g. a
# low-pressure/gravity-fed storage heater) has no symbol and so cannot be drawn on
# direct supply at all, which is what lets Rule 6.2 be a plain symbol-type check.
_DIRECT_CONNECT_HEATER_SYMBOL_IDS = {"water_heater", "instantaneous_water_heater"}


# ---------------------------------------------------------------------------
# Rule 6.1 — Heat pump supply mode consistency
# ---------------------------------------------------------------------------

def _check_supply_mode_consistency(elements: list[dict]) -> tuple[str, list[str]]:
    """
    For every fitting with distinct Hot and Cold ports, its hot and cold supply
    must come from the same mode (both direct-from-mains or both indirect-via-tank).
    A fitting fed hot water via a tank/pump/heater but cold water straight from
    mains (or vice versa) is exactly the cross-connection SS636 6.1 is meant to
    catch — it's checked per-fitting rather than as a whole-drawing aggregate,
    since a drawing can legitimately mix direct and indirect zones (e.g. a tank
    feeding only the water heater) as long as no single fitting's hot and cold
    disagree.

    Returns (detail line, mismatched fitting element_ids).
    """
    heaters = [e for e in elements if e.get("symbol_id") in _DIRECT_CONNECT_HEATER_SYMBOL_IDS]
    if not heaters:
        return "– Rule 6.1: No water heater detected — heat pump supply mode check skipped.", []

    checked = 0
    mismatches: list[str] = []
    mismatch_ids: list[str] = []
    for fitting in elements:
        if fitting.get("node_type") != "water_fitting":
            continue
        ports = fitting.get("ports") or []
        hot_mode = next((p.get("supply_mode") for p in ports if p.get("label") == "Hot"), None)
        cold_mode = next((p.get("supply_mode") for p in ports if p.get("label") == "Cold"), None)
        if not hot_mode or not cold_mode:
            continue
        checked += 1
        if hot_mode != cold_mode:
            mismatches.append(f"{fitting.get('symbol_id', fitting.get('id'))} (hot={hot_mode}, cold={cold_mode})")
            mismatch_ids.append(fitting["id"])

    if checked == 0:
        return "– Rule 6.1: No fitting with distinct hot/cold supply ports detected — supply mode consistency check skipped.", []

    if mismatches:
        return (
            f"✗ Rule 6.1: {len(mismatches)} fitting(s) have mismatched hot/cold supply modes: "
            f"{'; '.join(mismatches)}. Cold and hot water supplied to the same fitting must "
            f"come via the same mode (both direct or both indirect) — a mismatch risks a sudden "
            f"pressure/temperature shift (e.g. scalding) when the user adjusts the mixer."
        ), mismatch_ids
    return (
        f"✓ Rule 6.1: All {checked} fitting(s) with hot/cold supply have consistent supply "
        f"modes — supply mode consistency satisfied."
    ), []


# ---------------------------------------------------------------------------
# Rule 6.2 — Direct-supply heater type (mains-pressure storage or instantaneous)
# ---------------------------------------------------------------------------

_HEATER_TYPE_LABELS = {
    "water_heater": "mains-pressure storage",
    "instantaneous_water_heater": "instantaneous",
}


def _check_heater_direct_supply_type(elements: list[dict]) -> list[tuple[str, str]]:
    """
    SS636 §6.5.1/§6.5.2: only mains-pressure storage or instantaneous water heaters
    may be connected directly to the service pipe for cold water supply. Since those
    are the only two heater symbols in the library, any heater drawn is one of the
    two compliant types by construction — this is a symbol-type check, not a
    verification of the physical unit's actual pressure rating.

    Returns (detail line, heater element_id) pairs.
    """
    heaters = [e for e in elements if e.get("symbol_id") in _DIRECT_CONNECT_HEATER_SYMBOL_IDS]
    if not heaters:
        return [("– Rule 6.2: No water heater detected — direct-supply heater type check skipped.", "")]

    lines: list[tuple[str, str]] = []
    for heater in heaters:
        name = heater.get("symbol_name", "Water Heater")
        heater_type = _HEATER_TYPE_LABELS.get(heater.get("symbol_id"), "unknown")
        supply_mode = heater.get("supply_mode")
        if supply_mode == "direct_supply":
            lines.append((
                f"✓ Rule 6.2: [{name}] on direct supply — {heater_type} type, as required "
                f"under SS636 §6.5.1/§6.5.2.",
                heater["id"],
            ))
        else:
            lines.append((
                f"– Rule 6.2: [{name}] not on direct supply — direct-connection heater-type "
                f"restriction (SS636 §6.5.1/§6.5.2) not applicable.",
                heater["id"],
            ))
    return lines


def _has_series_check_valves(
    adj: dict[str, set[str]],
    start_id: str,
    elem_by_id: dict[str, dict],
    max_hops: int = DEFAULT_MAX_HOPS,
    required: int = 2,
) -> bool:
    """DFS from start_id; returns True iff some SIMPLE path from start_id (within
    max_hops) passes through at least `required` check_valve elements in series.

    Must walk simple paths (no node repeated within a single path) rather than a
    plain BFS/visited-set count: on this undirected graph, a BFS that only dedupes
    by (node, chain_count) can bounce back and forth across a single check valve
    (start -> cv -> start -> cv again with a different distance) and double-count
    the same physical valve as if it were two in series. Backtracking DFS avoids
    that, and — since it's per-path — also correctly refuses to credit two check
    valves that sit on unrelated branches off a shared main line (each protecting
    a different fixture) as a single valid "double check valve assembly" for this
    heater.
    """
    def dfs(node: str, dist: int, chain: int, path: set[str]) -> bool:
        if dist >= max_hops:
            return False
        for nbr in adj.get(node, ()):
            if nbr in path:
                continue
            el = elem_by_id.get(nbr)
            nbr_chain = chain + 1 if (el and el.get("symbol_id") == "check_valve") else chain
            if nbr_chain >= required:
                return True
            path.add(nbr)
            if dfs(nbr, dist + 1, nbr_chain, path):
                return True
            path.remove(nbr)
        return False

    return dfs(start_id, 0, 0, {start_id})


# ---------------------------------------------------------------------------
# Rule 6.3 — Water heater protection assembly (CV+PRV, or double check valve)
# ---------------------------------------------------------------------------

def _check_heater_protection(
    elements: list[dict],
    pipes: list[dict],
    elem_by_id: dict[str, dict],
    adj: dict[str, set[str]],
) -> list[tuple[str, str]]:
    """
    PASS requires (check_valve AND pressure_relief_valve) OR a double check
    valve assembly (two check_valve elements in series) — matching the WSI
    Landed checklist wording exactly. A single check valve alone (no PRV,
    not doubled) satisfies neither option and FAILs.

    Returns (detail line, heater element_id) pairs.
    """
    heaters = [e for e in elements if e.get("symbol_id") == "water_heater"]
    if not heaters:
        return [("– Rule 6.3: No water heater detected — heater protection assembly check skipped.", "")]

    lines: list[tuple[str, str]] = []
    for heater in heaters:
        name = heater.get("symbol_name", "Water Heater")
        hid = heater["id"]

        cv_id, cv_hops = _bfs_find(adj, hid, {"check_valve"}, elem_by_id)
        prv_id, prv_hops = _bfs_find(adj, hid, {"pressure_relief_valve"}, elem_by_id)
        has_series_cv = _has_series_check_valves(adj, hid, elem_by_id)

        if cv_id and prv_id:
            lines.append((
                f"✓ Rule 6.3: [{name}] Check valve and pressure relief valve assembly detected — "
                f"backflow protection confirmed.",
                hid,
            ))
        elif has_series_cv:
            lines.append((
                f"✓ Rule 6.3: [{name}] Double check valve assembly detected (two check valves in series) — "
                f"backflow protection confirmed.",
                hid,
            ))
        else:
            found_desc = []
            if cv_id:
                pos = "immediately adjacent" if cv_hops == 1 else f"{cv_hops} hops away"
                found_desc.append(f"a single check valve ({pos})")
            if prv_id:
                pos = "immediately adjacent" if prv_hops == 1 else f"{prv_hops} hops away"
                found_desc.append(f"a pressure relief valve ({pos}) with no check valve")
            found_str = f" Found: {', '.join(found_desc)}." if found_desc else ""
            lines.append((
                f"✗ Rule 6.3: [{name}] No qualifying protection assembly found within {DEFAULT_MAX_HOPS} hops. "
                f"Per the WSI checklist, the water heater must be installed with EITHER a check valve + "
                f"pressure relief valve assembly OR a double check valve assembly.{found_str}",
                hid,
            ))
    return lines


# ---------------------------------------------------------------------------
# Rule 6.4 — Double check valves for appliance fittings
# ---------------------------------------------------------------------------

_APPLIANCE_DISPLAY_NAMES = {
    "washing_machine": "Washing Machine",
    "dishwasher": "Dishwasher",
    "water_dispenser": "Water Dispenser",
    "bib_tap_cw_cap_and_lock_schematic": "Bib Tap (Landscape)",
}


def _appliance_display_name(el: dict) -> str:
    sid = el.get("symbol_id", "")
    if sid in _APPLIANCE_DISPLAY_NAMES:
        return _APPLIANCE_DISPLAY_NAMES[sid]
    return el.get("fitting_type", "Appliance").replace("_", " ").title()


def _check_appliance_check_valves(
    elements: list[dict],
    elem_by_id: dict[str, dict],
    adj: dict[str, set[str]],
) -> list[tuple[str, str]]:
    """Returns (detail line, appliance element_id) pairs."""
    # backflow_requirement == "check_valve" is exported by the frontend for all §6.4 appliances
    # and for water_heater (Reg 28). Exclude water_heater — it has its own Rule 6.3 check.
    appliances = [
        e for e in elements
        if e.get("backflow_requirement") == "check_valve"
        and e.get("symbol_id") != "water_heater"
    ]
    if not appliances:
        return [("– Rule 6.4: No appliance fittings (dishwasher / water dispenser / washing machine / landscape tap / ice maker / coffee maker / refrigerator / balancing tank) detected — check skipped.", "")]

    lines: list[tuple[str, str]] = []
    for el in appliances:
        name = _appliance_display_name(el)
        cv_id, _ = _bfs_find(adj, el["id"], {"check_valve"}, elem_by_id, max_hops=3)
        if cv_id:
            lines.append((f"✓ Rule 6.4: [{name}] Check valve detected upstream — backflow prevention present.", el["id"]))
        else:
            lines.append((
                f"✗ Rule 6.4: [{name}] No check valve found within 3 hops. "
                f"A double check valve must be installed before {name} fittings to prevent contamination.",
                el["id"],
            ))
    return lines


# ---------------------------------------------------------------------------
# Rule 6.5 — Bidet spray vacuum breaker
# ---------------------------------------------------------------------------

def _check_bidet_vacuum_breaker(
    elements: list[dict],
    elem_by_id: dict[str, dict],
    adj: dict[str, set[str]],
) -> list[tuple[str, str]]:
    """Returns (detail line, bidet element_id) pairs."""
    bidets = [e for e in elements if e.get("symbol_id") == "bidet_spray"]
    if not bidets:
        return [("– Rule 6.5: No bidet spray detected — vacuum breaker check skipped.", "")]

    lines: list[tuple[str, str]] = []
    for el in bidets:
        name = el.get("symbol_name", "Bidet Spray")
        el_id = el["id"]
        result = check_assembly_order(
            el_id, adj, elem_by_id,
            outer_type="check_valve", inner_type="vacuum_breaker",
        )
        cv_id, cv_hops = result.outer_id, result.outer_hops
        vb_id, vb_hops = result.inner_id, result.inner_hops

        if result.reason == "missing_both":
            lines.append((
                f"✗ Rule 6.5: [{name}] No vacuum breaker or check valve detected. "
                f"A vacuum breaker and check valve assembly must be installed on all bidet spray connections.",
                el_id,
            ))
        elif result.reason == "missing_inner":
            lines.append((
                f"✗ Rule 6.5: [{name}] No vacuum breaker found. "
                f"Both a vacuum breaker AND check valve are required for bidet spray installations.",
                el_id,
            ))
        elif result.reason == "missing_outer":
            lines.append((
                f"✗ Rule 6.5: [{name}] Vacuum breaker detected but no check valve found. "
                f"Both a vacuum breaker AND check valve are required for bidet spray installations.",
                el_id,
            ))
        elif result.reason == "wrong_order":
            # check_valve is not strictly farther from the bidet spray than vacuum_breaker —
            # assembly order is wrong: correct order is inlet → check_valve → vacuum_breaker → bidet_spray.
            lines.append((
                f"✗ Rule 6.5: [{name}] Assembly order incorrect — check valve must be upstream of "
                f"vacuum breaker (inlet → check valve → vacuum breaker → bidet spray). "
                f"Currently check valve is {cv_hops} hop(s) away and vacuum breaker is {vb_hops} hop(s) away.",
                el_id,
            ))
        else:
            lines.append((
                f"✓ Rule 6.5: [{name}] Vacuum breaker and check valve assembly detected in correct order "
                f"(vacuum breaker {vb_hops} hop(s), check valve {cv_hops} hop(s) from bidet spray) — "
                f"contamination prevention requirements satisfied.",
                el_id,
            ))
    return lines


# ---------------------------------------------------------------------------
# Detail deduplication
# ---------------------------------------------------------------------------

def _deduplicate_rule_lines(lines: list[str]) -> list[str]:
    """
    Collapse repeated rule bullets that differ only by the bracketed element name.

    Handles lines of the form:  "... Rule N.N: [Name] body text..."
    E.g. 4× "⚠ Rule 6.3: [Storage Water Heater] CV found but no PRV..."
    collapses to "⚠ Rule 6.3: [Storage Water Heater ×4] CV found but no PRV..."

    Lines with different bodies or without a bracketed name pass through unchanged.
    """
    def _parse(line: str):
        # Find first '[...]' pair that has 'Rule' somewhere before it
        try:
            br_open = line.index('[')
            br_close = line.index(']', br_open)
        except ValueError:
            return None
        prefix = line[:br_open]
        if 'Rule' not in prefix:
            return None
        name = line[br_open + 1:br_close]
        body = line[br_close + 1:].lstrip(' ')
        return (prefix, name, body)

    parsed = []
    for line in lines:
        p = _parse(line)
        if p:
            prefix, name, body = p
            parsed.append(((prefix, body), name, line))
        else:
            parsed.append((None, None, line))

    key_counts: Counter = Counter(p[0] for p in parsed if p[0] is not None)
    key_names: dict = defaultdict(list)
    for key, name, _ in parsed:
        if key is not None:
            key_names[key].append(name)

    seen: set = set()
    result: list[str] = []
    for key, _name, line in parsed:
        if key is None:
            result.append(line)
            continue
        if key in seen:
            continue
        seen.add(key)
        count = key_counts[key]
        if count > 1:
            prefix, body = key
            unique_names = list(dict.fromkeys(key_names[key]))
            label = unique_names[0] if len(unique_names) == 1 else ", ".join(unique_names)
            result.append(f"{prefix}[{label} ×{count}] {body}")
        else:
            result.append(line)
    return result


# ---------------------------------------------------------------------------
# Main check
# ---------------------------------------------------------------------------

def check_hot_water_contamination(metadata: dict[str, Any], adj: dict[str, set[str]] | None = None) -> CheckResult:
    """
    Section 6 — Hot water / Contamination prevention checks.

    Automated checks (graph topology):
      6.1  Heat pump supply mode consistency
      6.2  Direct-supply heaters are mains-pressure storage or instantaneous type
           (symbol-type check — see _DIRECT_CONNECT_HEATER_SYMBOL_IDS)
      6.3  Water heater protection assembly (check_valve + pressure_relief_valve)
      6.4  Appliance double check valves
      6.5  Bidet spray vacuum breaker + check valve assembly

    Acknowledgment-based checks:
      6.6  Tanks/pumps not below sanitary pipes (LP/PE confirmation)
    """
    elements: list[dict] = metadata.get("elements", [])
    pipes: list[dict] = metadata.get("pipes", [])
    elem_by_id = {e["id"]: e for e in elements}
    adj = adj if adj is not None else build_adjacency(elements, pipes)

    heaters = [e for e in elements if e.get("symbol_id") in _DIRECT_CONNECT_HEATER_SYMBOL_IDS]
    bidets   = [e for e in elements if e.get("symbol_id") == "bidet_spray"]
    appliances = [
        e for e in elements
        if e.get("backflow_requirement") == "check_valve"
        and e.get("symbol_id") != "water_heater"
    ]
    has_tank_or_pump = any(
        e.get("symbol_id") in ("water_tank", "pump") for e in elements
    )

    if not heaters and not bidets and not appliances and not has_tank_or_pump:
        return CheckResult(
            check_id="HOT_WATER",
            title="Hot Water / Contamination Prevention",
            status="SKIP",
            summary="No water heaters, bidet sprays, or applicable appliances detected — check skipped.",
            detail=["Add water heater, bidet spray, or appliance fittings to enable Section 6 checks."],
        )

    detail: list[str] = []
    sub_statuses: list[str] = []
    issues: list[dict] = []

    # ── Rule 6.1 ──────────────────────────────────────────────────────────────
    r61, r61_ids = _check_supply_mode_consistency(elements)
    detail.append(r61)
    if r61.startswith("✓"):
        sub_statuses.append("PASS")
    elif r61.startswith("✗"):
        sub_statuses.append("FAIL")
        issues.append({"status": "FAIL", "text": r61[2:].strip(), "element_ids": r61_ids})

    # ── Rule 6.2 ──────────────────────────────────────────────────────────────
    r62_pairs = _check_heater_direct_supply_type(elements)
    detail.extend(line for line, _ in r62_pairs)
    for line, heater_id in r62_pairs:
        if line.startswith("✓"):
            sub_statuses.append("PASS")
        elif line.startswith("✗"):
            sub_statuses.append("FAIL")
            issues.append({"status": "FAIL", "text": line[2:].strip(), "element_ids": [heater_id] if heater_id else []})

    # ── Rule 6.3 ──────────────────────────────────────────────────────────────
    r63_pairs = _check_heater_protection(elements, pipes, elem_by_id, adj)
    detail.extend(line for line, _ in r63_pairs)
    for line, heater_id in r63_pairs:
        if line.startswith("✓"):
            sub_statuses.append("PASS")
        elif line.startswith("⚠"):
            sub_statuses.append("WARN")
            issues.append({"status": "WARN", "text": line[2:].strip(), "element_ids": [heater_id] if heater_id else []})
        elif line.startswith("✗"):
            sub_statuses.append("FAIL")
            issues.append({"status": "FAIL", "text": line[2:].strip(), "element_ids": [heater_id] if heater_id else []})

    # ── Rule 6.4 ──────────────────────────────────────────────────────────────
    r64_pairs = _check_appliance_check_valves(elements, elem_by_id, adj)
    detail.extend(line for line, _ in r64_pairs)
    for line, appl_id in r64_pairs:
        if line.startswith("✓"):
            sub_statuses.append("PASS")
        elif line.startswith("⚠"):
            sub_statuses.append("WARN")
            issues.append({"status": "WARN", "text": line[2:].strip(), "element_ids": [appl_id] if appl_id else []})
        elif line.startswith("✗"):
            sub_statuses.append("FAIL")
            issues.append({"status": "FAIL", "text": line[2:].strip(), "element_ids": [appl_id] if appl_id else []})

    r64_all_resolved = bool(r64_pairs) and all(line.startswith("✓") for line, _ in r64_pairs)
    if appliances and not r64_all_resolved:
        appl_ack = metadata.get("appliance_check_valve_acknowledged", False)
        if appl_ack:
            detail.append(
                "✓ Rule 6.4: LP/PE confirmed double check valves are installed for all applicable appliances."
            )
            sub_statuses.append("PASS")
        else:
            text = (
                "Rule 6.4: LP/PE acknowledgment for appliance check valves not provided — "
                "please confirm in the pre-evaluation checklist."
            )
            detail.append(f"⚠ {text}")
            sub_statuses.append("WARN")
            issues.append({"status": "WARN", "text": text, "element_ids": [a["id"] for a in appliances]})

    # ── Rule 6.5 ──────────────────────────────────────────────────────────────
    r65_pairs = _check_bidet_vacuum_breaker(elements, elem_by_id, adj)
    detail.extend(line for line, _ in r65_pairs)
    for line, bidet_id in r65_pairs:
        if line.startswith("✓"):
            sub_statuses.append("PASS")
        elif line.startswith("⚠"):
            sub_statuses.append("WARN")
            issues.append({"status": "WARN", "text": line[2:].strip(), "element_ids": [bidet_id] if bidet_id else []})
        elif line.startswith("✗"):
            sub_statuses.append("FAIL")
            issues.append({"status": "FAIL", "text": line[2:].strip(), "element_ids": [bidet_id] if bidet_id else []})

    r65_all_resolved = bool(r65_pairs) and all(line.startswith("✓") for line, _ in r65_pairs)
    if bidets and not r65_all_resolved:
        bidet_ack = metadata.get("bidet_vacuum_breaker_acknowledged", False)
        if bidet_ack:
            detail.append(
                "✓ Rule 6.5: LP/PE confirmed vacuum breaker and check valve assembly is installed "
                "for all bidet spray connections."
            )
            sub_statuses.append("PASS")
        else:
            text = (
                "Rule 6.5: LP/PE acknowledgment for bidet vacuum breaker assembly not provided — "
                "please confirm in the pre-evaluation checklist."
            )
            detail.append(f"⚠ {text}")
            sub_statuses.append("WARN")
            issues.append({"status": "WARN", "text": text, "element_ids": [b["id"] for b in bidets]})

    # ── Rule 6.6 (acknowledgment) ─────────────────────────────────────────────
    if has_tank_or_pump:
        pos_ack = metadata.get("tank_position_acknowledged", False)
        if pos_ack:
            detail.append(
                "✓ Rule 6.6: LP/PE confirmed tanks and pumps are NOT installed below any sanitary "
                "or non-potable water pipes."
            )
            sub_statuses.append("PASS")
        else:
            text = (
                "Rule 6.6: Tank/pump position not confirmed — please acknowledge in the "
                "pre-evaluation checklist that tanks and pumps are not installed below sanitary pipes."
            )
            detail.append(f"⚠ {text}")
            sub_statuses.append("WARN")
            tank_pump_ids = [e["id"] for e in elements if e.get("symbol_id") in ("water_tank", "pump")]
            issues.append({"status": "WARN", "text": text, "element_ids": tank_pump_ids})

    # ── Overall status ────────────────────────────────────────────────────────
    if "FAIL" in sub_statuses:
        status = "FAIL"
        summary = "One or more hot water / contamination prevention requirements are not met."
    elif "WARN" in sub_statuses:
        status = "WARN"
        summary = "Hot water / contamination checks passed with warnings — review advisory items and complete acknowledgments."
    elif sub_statuses:
        status = "PASS"
        summary = "All Section 6 hot water and contamination prevention requirements are satisfied."
    else:
        status = "SKIP"
        summary = "No applicable elements for Section 6 checks."

    return CheckResult(
        check_id="HOT_WATER",
        title="Hot Water / Contamination Prevention",
        status=status,
        summary=summary,
        detail=_deduplicate_rule_lines(detail),
        issues=issues,
    )
