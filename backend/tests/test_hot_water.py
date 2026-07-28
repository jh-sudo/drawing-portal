"""
HOT_WATER — Section 6: Hot water / Contamination prevention

Key behaviour under test:
- Rule 6.1: heat pump supply mode consistency (heaters + fittings same mode)
- Rule 6.2: direct-supply heater must be water_heater (mains-pressure storage) or
  instantaneous_water_heater — automated symbol-type check, no acknowledgment
- Rule 6.3: water_heater needs check_valve + pressure_relief_valve (graph)
- Rule 6.4: §6.4 appliances (backflow_requirement=check_valve, not water_heater) need check_valve
- Rule 6.5: bidet/bidet_spray (backflow_requirement=vacuum_breaker) needs vacuum_breaker + check_valve

We test detail lines rather than overall status because acknowledgment-based sub-checks
(6.4 ack, 6.5 ack, 6.6) always add WARNs in test conditions.
"""

import pytest
from tests.helpers import el, pipe, meta, has_pass_line, has_fail_line, has_warn_line
from app.agents.hot_water_contamination_check import check_hot_water_contamination


# ---------------------------------------------------------------------------
# SKIP
# ---------------------------------------------------------------------------

def test_skip_no_relevant_elements():
    m = meta([el("s1", "shower_head", node_type="water_fitting")])
    r = check_hot_water_contamination(m)
    assert r.status == "SKIP"


def test_skip_only_tanks_and_pumps():
    """Tanks and pumps alone do not trigger section 6 — check should SKIP."""
    m = meta([
        el("t1", "water_tank"),
        el("p1", "pump"),
    ])
    # has_tank_or_pump is True → check runs but only 6.6 acknowledgment applies
    # Should not be SKIP (tank_or_pump triggers a check), but also not FAIL
    r = check_hot_water_contamination(m)
    assert r.status != "SKIP"


# ---------------------------------------------------------------------------
# Rule 6.2 — Direct-supply heater type (automated symbol-type check)
# ---------------------------------------------------------------------------

def test_rule62_storage_heater_on_direct_supply_passes_no_ack():
    m = meta([el("h1", "water_heater", supply_mode="direct_supply")])
    r = check_hot_water_contamination(m)
    assert has_pass_line(r.detail, "Rule 6.2")
    assert not has_warn_line(r.detail, "Rule 6.2")


def test_rule62_instantaneous_heater_on_direct_supply_passes_no_ack():
    m = meta([el("h1", "instantaneous_water_heater", supply_mode="direct_supply")])
    r = check_hot_water_contamination(m)
    assert has_pass_line(r.detail, "Rule 6.2")
    assert not has_warn_line(r.detail, "Rule 6.2")


def test_rule62_heater_on_indirect_supply_not_applicable():
    """A tank-fed heater isn't subject to the direct-connection type restriction at all."""
    m = meta([el("h1", "water_heater", supply_mode="indirect_supply")])
    r = check_hot_water_contamination(m)
    assert not has_pass_line(r.detail, "Rule 6.2")
    assert not has_fail_line(r.detail, "Rule 6.2")
    assert not has_warn_line(r.detail, "Rule 6.2")


# ---------------------------------------------------------------------------
# Rule 6.3 — Water heater protection assembly
# ---------------------------------------------------------------------------

def test_rule63_heater_with_check_valve_and_prv_passes():
    elements = [
        el("h1", "water_heater"),
        el("cv1", "check_valve"),
        el("prv1", "pressure_relief_valve"),
    ]
    pipes = [pipe("p1", "cv1", "h1"), pipe("p2", "prv1", "h1")]
    r = check_hot_water_contamination(meta(elements, pipes))
    assert has_pass_line(r.detail, "Rule 6.3")


def test_rule63_heater_with_single_check_valve_only_fails():
    """
    A lone check valve (no PRV, not doubled) satisfies neither WSI checklist
    option ("CV + PRV assembly" OR "double check valve assembly") — must FAIL,
    not warn or pass.
    """
    elements = [
        el("h1", "water_heater"),
        el("cv1", "check_valve"),
    ]
    r = check_hot_water_contamination(meta(elements, [pipe("p1", "cv1", "h1")]))
    assert has_fail_line(r.detail, "Rule 6.3")


def test_rule63_heater_with_prv_only_fails():
    """A lone PRV (no check valve at all) likewise satisfies neither option."""
    elements = [
        el("h1", "water_heater"),
        el("prv1", "pressure_relief_valve"),
    ]
    r = check_hot_water_contamination(meta(elements, [pipe("p1", "prv1", "h1")]))
    assert has_fail_line(r.detail, "Rule 6.3")


def test_rule63_heater_with_double_check_valve_passes():
    """Two check valves in series (no PRV) is the other qualifying option — must PASS."""
    elements = [
        el("h1", "water_heater"),
        el("cv1", "check_valve"),
        el("cv2", "check_valve"),
    ]
    pipes = [pipe("p1", "cv1", "h1"), pipe("p2", "cv2", "cv1")]
    r = check_hot_water_contamination(meta(elements, pipes))
    assert has_pass_line(r.detail, "Rule 6.3")


def test_rule63_heater_no_protection_fails():
    m = meta([el("h1", "water_heater")])
    r = check_hot_water_contamination(m)
    assert has_fail_line(r.detail, "Rule 6.3")


def test_rule63_unrelated_check_valve_on_other_branch_does_not_count():
    """
    Regression: a water heater with exactly one genuine upstream check valve
    (no PRV — must FAIL) sits on a shared main alongside a dishwasher that has
    its own, separate check valve for Rule 6.4. The dishwasher's valve is
    reachable from the heater within the 5-hop search radius, but it is on an
    unrelated branch, not in series with the heater's own valve — it must NOT
    be counted towards Rule 6.3's "double check valve assembly" and produce a
    false PASS.
    """
    elements = [
        el("h1", "water_heater"),
        el("cv1", "check_valve"),
        el("dw1", "dishwasher", backflow_requirement="check_valve"),
        el("cv2", "check_valve"),
    ]
    pipes = [
        pipe("p1", "cv1", "h1"),   # cv1 genuinely protects h1 (alone — insufficient)
        pipe("p2", "h1", "dw1"),   # shared main branch point
        pipe("p3", "cv2", "dw1"),  # cv2 protects dw1 under Rule 6.4, unrelated to h1
    ]
    r = check_hot_water_contamination(meta(elements, pipes))
    assert has_fail_line(r.detail, "Rule 6.3")
    assert not has_pass_line(r.detail, "Rule 6.3")


# ---------------------------------------------------------------------------
# Rule 6.4 — Appliance double check valves
# ---------------------------------------------------------------------------

def test_rule64_appliance_with_check_valve_passes():
    elements = [
        el("wm1", "washing_machine", backflow_requirement="check_valve"),
        el("cv1", "check_valve"),
    ]
    r = check_hot_water_contamination(meta(elements, [pipe("p1", "cv1", "wm1")]))
    assert has_pass_line(r.detail, "Rule 6.4")


def test_rule64_appliance_without_check_valve_fails():
    m = meta([el("dw1", "dishwasher", backflow_requirement="check_valve")])
    r = check_hot_water_contamination(m)
    assert has_fail_line(r.detail, "Rule 6.4")


def test_rule64_water_heater_not_included():
    """
    CRITICAL: water_heater has backflow_requirement='check_valve' but must NOT appear in
    Rule 6.4 (it has its own Rule 6.3 check). This verifies the symbol_id != 'water_heater'
    exclusion is working.
    """
    # Only a water_heater — Rule 6.4 should be skipped (no appliances), Rule 6.3 handles it
    m = meta([el("h1", "water_heater", backflow_requirement="check_valve")])
    r = check_hot_water_contamination(m)
    assert not has_fail_line(r.detail, "Rule 6.4")
    # Rule 6.4 skipped when no appliances
    assert any("6.4" in d and "skipped" in d.lower() for d in r.detail)


def test_rule64_landscape_tap_without_check_valve_fails():
    m = meta([el("bt1", "bib_tap_cw_cap_and_lock_schematic", backflow_requirement="check_valve")])
    r = check_hot_water_contamination(m)
    assert has_fail_line(r.detail, "Rule 6.4")


def test_rule64_multiple_appliances_one_protected_one_not():
    elements = [
        el("wm1", "washing_machine", backflow_requirement="check_valve"),
        el("dw1", "dishwasher", backflow_requirement="check_valve"),
        el("cv1", "check_valve"),
    ]
    pipes = [pipe("p1", "cv1", "wm1")]  # only washing machine is protected
    r = check_hot_water_contamination(meta(elements, pipes))
    assert has_pass_line(r.detail, "Rule 6.4")   # washing machine passes
    assert has_fail_line(r.detail, "Rule 6.4")   # dishwasher fails


def test_rule64_all_appliances_protected_no_ack_warn():
    """
    Regression: when every appliance already has an automated check_valve pass,
    the acknowledgment gate must NOT add an extra WARN — a correctly drawn
    schematic should not require ticking the ack box.
    """
    elements = [
        el("wm1", "washing_machine", backflow_requirement="check_valve"),
        el("dw1", "dishwasher", backflow_requirement="check_valve"),
        el("cv1", "check_valve"),
        el("cv2", "check_valve"),
    ]
    pipes = [pipe("p1", "cv1", "wm1"), pipe("p2", "cv2", "dw1")]
    r = check_hot_water_contamination(meta(elements, pipes))
    assert not has_warn_line(r.detail, "Rule 6.4")
    assert not any("acknowledgment" in d.lower() and "6.4" in d for d in r.detail)


def test_rule64_unresolved_appliance_still_requires_ack():
    """When an appliance fails the automated check, the ack gate still applies."""
    m = meta([el("dw1", "dishwasher", backflow_requirement="check_valve")])
    r = check_hot_water_contamination(m)
    assert has_fail_line(r.detail, "Rule 6.4")
    assert any("acknowledgment" in d.lower() and "6.4" in d for d in r.detail)


# ---------------------------------------------------------------------------
# Rule 6.5 — Bidet spray vacuum breaker
# ---------------------------------------------------------------------------

def test_rule65_bidet_with_correct_assembly_passes():
    """Correct order: inlet → check_valve → vacuum_breaker → bidet_spray."""
    elements = [
        el("b1", "bidet_spray", backflow_requirement="vacuum_breaker"),
        el("vb1", "vacuum_breaker"),
        el("cv1", "check_valve"),
    ]
    pipes_ = [pipe("p1", "cv1", "vb1"), pipe("p2", "vb1", "b1")]
    r = check_hot_water_contamination(meta(elements, pipes_))
    assert has_pass_line(r.detail, "Rule 6.5")


def test_rule65_bidet_no_protection_fails():
    m = meta([el("b1", "bidet_spray", backflow_requirement="vacuum_breaker")])
    r = check_hot_water_contamination(m)
    assert has_fail_line(r.detail, "Rule 6.5")


def test_rule65_bidet_vacuum_breaker_only_fails():
    """
    Vacuum breaker present but no check valve — this is a confirmed missing
    backflow-protection component (contamination risk), so it must FAIL, not
    just warn. Matches the identical condition's severity in REG28
    (compliance_checks.py::check_backflow_prevention) for the same element.
    """
    elements = [
        el("b1", "bidet_spray", backflow_requirement="vacuum_breaker"),
        el("vb1", "vacuum_breaker"),
    ]
    r = check_hot_water_contamination(meta(elements, [pipe("p1", "vb1", "b1")]))
    assert has_fail_line(r.detail, "Rule 6.5")
    assert not has_pass_line(r.detail, "Rule 6.5")


def test_rule65_wrong_assembly_order_fails():
    """Wrong order: inlet → vacuum_breaker → check_valve → bidet_spray should FAIL."""
    elements = [
        el("b1", "bidet_spray", backflow_requirement="vacuum_breaker"),
        el("vb1", "vacuum_breaker"),
        el("cv1", "check_valve"),
    ]
    # cv is 1 hop from bidet_spray, vb is 2 hops — wrong order
    pipes_ = [pipe("p1", "vb1", "cv1"), pipe("p2", "cv1", "b1")]
    r = check_hot_water_contamination(meta(elements, pipes_))
    assert has_fail_line(r.detail, "Rule 6.5")


def test_rule65_correct_assembly_no_ack_warn():
    """Regression: a correctly drawn bidet assembly must not require the ack checkbox."""
    elements = [
        el("b1", "bidet_spray", backflow_requirement="vacuum_breaker"),
        el("vb1", "vacuum_breaker"),
        el("cv1", "check_valve"),
    ]
    pipes_ = [pipe("p1", "cv1", "vb1"), pipe("p2", "vb1", "b1")]
    r = check_hot_water_contamination(meta(elements, pipes_))
    assert not has_warn_line(r.detail, "Rule 6.5")
    assert not any("acknowledgment" in d.lower() and "6.5" in d for d in r.detail)


# ---------------------------------------------------------------------------
# Rule 6.1 — Supply mode consistency (per-fitting hot vs cold, not a whole-
# drawing aggregate — a drawing can legitimately have both a direct zone and
# an indirect zone, e.g. a tank feeding only the heater, as long as no single
# fitting's own hot and cold ports disagree)
# ---------------------------------------------------------------------------

def test_rule61_skip_no_heater():
    """Without any heater/bidet/appliance the whole check is SKIP (no Rule 6.1 detail at all)."""
    m = meta([el("f1", "basin_tap", node_type="water_fitting")])
    r = check_hot_water_contamination(m)
    assert r.status == "SKIP"


def test_rule61_pass_consistent_hot_cold():
    """Fitting's Hot and Cold ports on the same supply mode — Rule 6.1 passes."""
    elements = [
        el("h1", "water_heater"),
        el("f1", "basin_tap", node_type="water_fitting", ports=[
            {"label": "Hot", "supply_mode": "direct_supply"},
            {"label": "Cold", "supply_mode": "direct_supply"},
        ]),
    ]
    r = check_hot_water_contamination(meta(elements))
    assert has_pass_line(r.detail, "Rule 6.1")


def test_rule61_fail_mismatched_hot_cold_on_same_fitting():
    """
    Regression for the reported bug: a fitting fed hot water indirectly (via
    tank/pump/heater) but cold water direct from mains — the actual
    cross-connection Rule 6.1 exists to catch. This is a confirmed BFS
    finding (not ambiguous/unverifiable), and a real safety risk — switching
    between hot and cold at the mixer can cause a sudden pressure/temperature
    shift — so it must FAIL, not just warn.
    """
    elements = [
        el("h1", "water_heater"),
        el("f1", "basin_tap", node_type="water_fitting", ports=[
            {"label": "Hot", "supply_mode": "indirect_supply"},
            {"label": "Cold", "supply_mode": "direct_supply"},
        ]),
    ]
    r = check_hot_water_contamination(meta(elements))
    assert has_fail_line(r.detail, "Rule 6.1")


def test_rule61_runs_with_only_instantaneous_heater():
    """
    Regression: Rule 6.1's guard used to only recognise symbol_id == 'water_heater',
    which would wrongly SKIP the whole hot/cold consistency check on a drawing whose
    only heater is an instantaneous_water_heater.
    """
    elements = [
        el("h1", "instantaneous_water_heater"),
        el("f1", "basin_tap", node_type="water_fitting", ports=[
            {"label": "Hot", "supply_mode": "indirect_supply"},
            {"label": "Cold", "supply_mode": "direct_supply"},
        ]),
    ]
    r = check_hot_water_contamination(meta(elements))
    assert has_fail_line(r.detail, "Rule 6.1")


def test_rule61_skip_no_fittings_with_hot_cold_ports():
    """Heater present but no fitting has distinct Hot/Cold ports with a resolved supply_mode — skipped."""
    elements = [
        el("h1", "water_heater"),
        el("f1", "basin_tap", node_type="water_fitting", ports=[{"label": "Supply", "supply_mode": None}]),
    ]
    r = check_hot_water_contamination(meta(elements))
    assert any("Rule 6.1" in line and "skipped" in line.lower() for line in r.detail)
