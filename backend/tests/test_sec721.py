"""
SEC721 — Water Efficiency (MWELS, Handbook 7.2.1)

Key behaviour under test:
- Backend now finds MWELS elements by checking "fitting_type" in element dict
  (exported by frontend for all symbols in FIXTURE_MWELS_CATEGORY).
- Elements without the fitting_type key are NOT included — even if they are water fittings.
- Appliances with no MWELS table entry (fitting_type in NON_MWELS_FITTING_IDS — water_dispenser,
  landscape_tap) appear as "not subject to MWELS" rows.
- washing_machine and dishwasher ARE MWELS-graded appliances (1-4 tick scale, per PUB's
  "Water Efficiency Rating & Requirements", 1 Dec 2021) — they are NOT in NON_MWELS_FITTING_IDS
  and are graded exactly like any other fixture (>=2 ticks to pass).
- fitting_type: None means ambiguous fixture needing user selection → WARN.
- A known fitting_type with no declared tick rating (efficiency_rating: None) → FAIL
  (undeclared MWELS labelling is non-compliant, not just missing data).
"""

import pytest
from tests.helpers import el, meta
from app.agents.compliance_checks import check_water_efficiency


def mwels_el(id_, sym, fitting_type, ticks=None, **kw):
    """Element with fitting_type key present (as the frontend exports for MWELS fixtures)."""
    return el(id_, sym, fitting_type=fitting_type, efficiency_rating=ticks, **kw)


# ---------------------------------------------------------------------------
# SKIP
# ---------------------------------------------------------------------------

def test_skip_no_mwels_elements():
    """Elements without a fitting_type key are not MWELS fixtures."""
    m = meta([el("p1", "pump")])
    r = check_water_efficiency(m)
    assert r.status == "SKIP"


def test_skip_tap_point_not_in_mwels():
    """tap_point_schematic is a water_fitting but not MWELS — frontend doesn't export fitting_type for it."""
    m = meta([el("t1", "tap_point_schematic", node_type="water_fitting")])
    r = check_water_efficiency(m)
    assert r.status == "SKIP"


# ---------------------------------------------------------------------------
# PASS
# ---------------------------------------------------------------------------

def test_pass_shower_head_2_ticks():
    m = meta([mwels_el("s1", "shower_head", "shower_tap", ticks=2)])
    r = check_water_efficiency(m)
    assert r.status == "PASS"
    assert r.table is not None
    assert r.table[0]["compliant"] is True


def test_pass_shower_head_3_ticks():
    m = meta([mwels_el("s1", "shower_head", "shower_tap", ticks=3)])
    r = check_water_efficiency(m)
    assert r.status == "PASS"


def test_pass_multiple_fixtures_all_compliant():
    elements = [
        mwels_el("s1", "shower_head", "shower_tap", ticks=2),
        mwels_el("b1", "wash_basin_rectangular", "basin_tap", ticks=3),
        mwels_el("wc1", "water_closet", "dual_flushing_cistern", ticks=2),
    ]
    r = check_water_efficiency(meta(elements))
    assert r.status == "PASS"
    assert all(row["compliant"] is True for row in r.table if row["compliant"] is not None)


# ---------------------------------------------------------------------------
# FAIL
# ---------------------------------------------------------------------------

def test_fail_1_tick_below_minimum():
    m = meta([mwels_el("s1", "shower_head", "shower_tap", ticks=1)])
    r = check_water_efficiency(m)
    assert r.status == "FAIL"
    assert r.table[0]["compliant"] is False


def test_fail_no_tick_rating_set():
    """A fitting with a known type but no declared tick rating is undeclared —
    Handbook 7.2.1 requires every fitting to carry a declared >=2-tick label, so this
    fails the check rather than just warning."""
    m = meta([mwels_el("s1", "shower_head", "shower_tap", ticks=None)])
    r = check_water_efficiency(m)
    assert r.status == "FAIL"
    assert r.table[0]["compliant"] is None


# ---------------------------------------------------------------------------
# WARN — missing data
# ---------------------------------------------------------------------------

def test_warn_ambiguous_fitting_type_none():
    """Frontend exports fitting_type=None for ambiguous fixtures (e.g. wash basin before user picks)."""
    m = meta([mwels_el("b1", "wash_basin_rectangular", fitting_type=None, ticks=None)])
    r = check_water_efficiency(m)
    assert r.status == "WARN"
    assert r.table[0]["compliant"] is None


# ---------------------------------------------------------------------------
# Non-MWELS appliances — no tick table exists (Section 6 check valve instead)
# ---------------------------------------------------------------------------

def test_appliance_water_dispenser_skipped_in_mwels():
    """water_dispenser has no MWELS table entry → appears as 'not subject to MWELS' row,
    and any tick rating on it is ignored rather than graded (there's nothing to grade it against)."""
    m = meta([mwels_el("wd1", "water_dispenser", "water_dispenser", ticks=2)])
    r = check_water_efficiency(m)
    assert r.status in ("PASS", "WARN", "SKIP")
    assert r.table is not None
    assert r.table[0]["compliant"] is None
    assert "not subject to mwels" in r.table[0]["note"].lower()
    assert not any("Missing data" in d for d in r.detail)


# ---------------------------------------------------------------------------
# Appliances with a real MWELS tick table — washing machine, dishwasher
# (PUB "Water Efficiency Rating & Requirements", 1 Dec 2021 — 1-4 tick scale,
# distinct from the 2-3 tick scale used for taps/cisterns/valves above)
# ---------------------------------------------------------------------------

def test_pass_washing_machine_4_ticks():
    m = meta([mwels_el("wm1", "washing_machine", "washing_machine", ticks=4)])
    r = check_water_efficiency(m)
    assert r.status == "PASS"
    assert r.table[0]["compliant"] is True
    assert r.table[0]["design_flow"] == 6.0
    assert r.table[0]["unit"] == "L/kg"


def test_fail_washing_machine_1_tick():
    """Washing machines have no 1-tick tier at all (rated NA below 2-tick) — a stray
    ticks=1 value must still fail, not crash on a missing '1' key in the MWELS table.
    The reported design_flow falls back to the worst (lowest-numbered) tier actually
    defined for this fitting — "2" — rather than a hardcoded assumption."""
    m = meta([mwels_el("wm1", "washing_machine", "washing_machine", ticks=1)])
    r = check_water_efficiency(m)
    assert r.status == "FAIL"
    assert r.table[0]["compliant"] is False
    assert r.table[0]["design_flow"] == 12.0


def test_fail_washing_machine_undeclared():
    m = meta([mwels_el("wm1", "washing_machine", "washing_machine", ticks=None)])
    r = check_water_efficiency(m)
    assert r.status == "FAIL"
    assert r.table[0]["compliant"] is None


def test_pass_dishwasher_3_ticks():
    m = meta([mwels_el("d1", "dishwasher", "dishwasher", ticks=3)])
    r = check_water_efficiency(m)
    assert r.status == "PASS"
    assert r.table[0]["compliant"] is True
    assert r.table[0]["design_flow"] == 0.9
    assert r.table[0]["unit"] == "L/place setting"


def test_fail_dishwasher_1_tick():
    """Dishwashers DO have a defined 1-tick tier (pre-Oct-2018 baseline), unlike washing
    machines — but 1 is still below the >=2 minimum, so it fails like any other fixture."""
    m = meta([mwels_el("d1", "dishwasher", "dishwasher", ticks=1)])
    r = check_water_efficiency(m)
    assert r.status == "FAIL"
    assert r.table[0]["compliant"] is False
    assert r.table[0]["design_flow"] == 1.5


# ---------------------------------------------------------------------------
# Mixed: one compliant, one non-compliant
# ---------------------------------------------------------------------------

def test_fail_1_tick_shower_still_contributes_worst_case_flow_to_total():
    """
    Regression: a 1-tick shower_tap (below the >=2 minimum, must FAIL) has no MWELS
    figure defined below the 2-tick tier, so its contribution to the "Total design
    flow demand" summary must resolve to the worst (lowest-numbered) tier actually
    in the table (7.0 L/min for shower_tap's "2" tier), not silently KeyError or
    fall back to an unrelated hardcoded value.
    """
    m = meta([mwels_el("s1", "shower_head", "shower_tap", ticks=1)])
    r = check_water_efficiency(m)
    assert r.status == "FAIL"
    assert r.table[0]["design_flow"] == 7.0
    assert any("7.0" in d and "Total design flow demand" in d for d in r.detail)


def test_fail_mixed_compliant_and_non_compliant():
    elements = [
        mwels_el("s1", "shower_head", "shower_tap", ticks=2),   # PASS
        mwels_el("b1", "wash_basin_rectangular", "basin_tap", ticks=1),  # FAIL
    ]
    r = check_water_efficiency(meta(elements))
    assert r.status == "FAIL"
    assert any(row["compliant"] is True for row in r.table)
    assert any(row["compliant"] is False for row in r.table)
