"""The committed Gotthard topology and traffic stay internally consistent.

These guard the output of `scripts/generate_gotthard.py`, not Flatland: the
files are neutral data (no grid), so the checks are about references, order
and provenance. See docs/plans/gotthard-scenario.md.
"""
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent.parent / "app" / "fixtures" / "gotthard"


@pytest.fixture(scope="module")
def topo():
    return json.loads((FIXTURES / "gotthard.topology.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def traffic():
    return json.loads((FIXTURES / "gotthard.traffic.json").read_text(encoding="utf-8"))


def _by_id(topo):
    return {o["id"]: o for o in topo["operatingPoints"]}


def test_sections_reference_known_points(topo):
    ops = _by_id(topo)
    for s in topo["sections"]:
        assert s["from"] in ops and s["to"] in ops, s["id"]
        assert s["km"] > 0, s["id"]
        assert s.get("lengthBasis"), f"{s['id']} has no provenance"


def test_routes_are_continuous_chains(topo):
    """Each route is a list of points joined by consecutive sections, and the
    mountain line and the base tunnel start and end at the same two junctions."""
    pairs = {(s["from"], s["to"]) for s in topo["sections"]}
    for name in ("north", "BG", "GBT", "south"):
        chain = topo["routes"][name]
        for a, b in zip(chain, chain[1:]):
            assert (a, b) in pairs, f"{name}: no section {a}->{b}"
    assert topo["routes"]["BG"][0] == topo["routes"]["GBT"][0] == topo["routes"]["north"][-1]
    assert topo["routes"]["BG"][-1] == topo["routes"]["GBT"][-1] == topo["routes"]["south"][0]


def _route_km(topo, name):
    chain = topo["routes"][name]
    km = {(s["from"], s["to"]): s["km"] for s in topo["sections"]}
    return sum(km[(a, b)] for a, b in zip(chain, chain[1:]))


def test_base_tunnel_is_shorter_than_the_mountain_line(topo):
    """The reason a closure is a decision. If this stops holding, the scenario's
    premise has changed, so fail loudly."""
    gbt, bg = _route_km(topo, "GBT"), _route_km(topo, "BG")
    assert 60 < gbt < 70
    assert 90 < bg < 100
    assert bg - gbt > 20


def test_tube_change_points_are_on_the_base_tunnel(topo):
    gbt = set(topo["routes"]["GBT"])
    assert set(topo["crossovers"]["tubeChange"]) <= gbt


def test_traffic_references_known_points_and_times_increase(topo, traffic):
    ops = _by_id(topo)
    assert traffic["passenger"], "no passenger trips"
    for t in traffic["passenger"]:
        assert t["route"] in ("BG", "GBT", "local")
        assert t["direction"] in ("N", "S")
        last = -1
        for c in t["calls"]:
            assert c["op"] in ops, f"{t['id']}: unknown point {c['op']}"
            assert c["arr"] <= c["dep"], t["id"]
            assert c["arr"] >= last, f"{t['id']}: time goes backwards"
            last = c["dep"]


def test_passenger_trips_split_by_route_as_published(traffic):
    """2025 SBB train counts: ~34 passenger trains a day and direction through
    the base tunnel. The timetable day must agree to within a few trains."""
    gbt = [t for t in traffic["passenger"] if t["scope"] == "through" and t["route"] == "GBT"]
    per_dir = len(gbt) / 2
    published = traffic["volumes"]["GBT"]["perDirectionPerDay"]["Personenverkehr"]
    assert abs(per_dir - published) <= 6, (per_dir, published)


def test_local_trips_are_marked_and_never_claim_a_tunnel(traffic):
    """S-Bahn pairs on one approach use capacity there but must not count as
    base-tunnel or mountain-line traffic."""
    for t in traffic["passenger"]:
        assert t["scope"] in ("through", "local")
        if t["scope"] == "local":
            assert t["route"] == "local", t["id"]
        else:
            assert t["route"] in ("BG", "GBT"), t["id"]


def test_freight_is_marked_synthetic_with_a_published_volume(traffic):
    assert traffic["freight"]
    for f in traffic["freight"]:
        assert f["basis"] == "synthetic"
        assert "sbb-open-data" in f["volumeBasis"]
        assert 0 <= f["entryTimeSeconds"] < 86400
    gbt_per_dir = sum(1 for f in traffic["freight"] if f["route"] == "GBT" and f["direction"] == "S")
    assert gbt_per_dir == max(1, round(traffic["volumes"]["GBT"]["perDirectionPerDay"]["Gueterverkehr"]))
    # The mountain line carries almost no freight, so the showcase has no phantom freight there.
    bg = [f for f in traffic["freight"] if f["route"] == "BG"]
    assert len(bg) <= 4
