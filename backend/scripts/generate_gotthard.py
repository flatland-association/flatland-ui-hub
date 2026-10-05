#!/usr/bin/env python
"""Build the neutral Gotthard topology and traffic from public data.

Layer 1 of docs/plans/gotthard-scenario.md. The output is deliberately not a
Flatland scene: it describes the network (operating points, sections with km,
the two base-tunnel tubes, crossovers) and the traffic (GTFS passenger trips,
synthetic freight at the published volume) with no grid and no step length.
Layer 2 turns it into whatever the engine needs, a grid scene today or a graph
later, so a change of Flatland version replaces only layer 2.

    cd backend
    .venv/bin/python scripts/generate_gotthard.py \\
        --gtfs /path/to/gtfs_fp2026_20260930.zip --date 2026-10-06

Needs network access (SBB open data API) and the Swiss GTFS timetable
(https://opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020, ~290 MB).
Streaming `stop_times.txt` (3.7 GB) takes a few minutes. The result is
committed, so this only has to run when the sources or the scope change.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import random
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "fixtures" / "gotthard"
SBB = "https://data.sbb.ch/api/explore/v2.1/catalog/datasets"

# Stage 1 runs from Arth-Goldau to Bellinzona (docs/plans/gotthard-scenario.md §2).
BG_LINE = 600                      # Immensee - Bellinzona - Chiasso (mountain line)
GBT_EAST, GBT_WEST = 595, 594      # base tunnel tubes
KM_FROM, KM_TO = 8.5, 150.95       # on line 600: Arth-Goldau .. Bellinzona
JUNCTION_N, JUNCTION_S = "RYAB", "GIDI"   # Rynacht (Abzw) .. Giustizia (dira)
# A mountain-line trip counts as through traffic if its calls cover this much of the
# Rynacht..Giustizia stretch (96 km); local S-Bahn pairs fall well below it.
MIN_MOUNTAIN_KM = 30
PORTALS = {"north": "Arth-Goldau", "south": "Bellinzona"}

# Base-tunnel nodes, in order, from line 595 (east tube). `bpk` is the SBB
# abbreviation; two points at one multifunction station are averaged.
GBT_NODES = [
    ("RYAB", ["RYSP"], "Rynacht (Abzw)", "junction"),
    ("SED", ["SSMF"], "Sedrun SMF", "crossover"),
    ("FAI", ["FSMN", "FSMS"], "Faido SMF", "crossover"),
    ("POZZ", ["POZZ"], "Pozzo Negro (dira)", "junction"),
    ("POLS", ["POLS"], "Pollegio binario di sorpasso", "loop"),
    ("GIDI", ["GIDI"], "Giustizia (dira)", "junction"),
]

# Names that exist only on the mountain line: a passenger trip calling at one
# of them runs over the mountain line, otherwise through the base tunnel.
SPEED_ASSUMPTIONS = {
    "basis": "assumed",
    "note": "Not in the open data. Typical values; replace with RhB/SBB figures if a source is found.",
    "kmh": {"GBT": {"IC": 200, "freight": 100}, "BG": {"IC": 120, "IR": 90, "freight": 65}, "common": {"IC": 140, "freight": 100}},
}


def fold(name: str) -> str:
    """Ascii-fold for matching GTFS names against SBB names."""
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().strip()


def api(dataset: str, **params) -> list[dict]:
    out, offset = [], 0
    while True:
        q = {**params, "limit": "100", "offset": str(offset)}
        url = f"{SBB}/{dataset}/records?" + urllib.parse.urlencode(q)
        with urllib.request.urlopen(url, timeout=90) as r:
            page = json.load(r)["results"]
        out += page
        if len(page) < 100:
            return out
        offset += 100


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def kind_of(name: str) -> str:
    """Operating-point kind from the SBB naming convention."""
    if "(Spw)" in name or "(c bin)" in name or "SMF" in name:
        return "crossover"          # Spurwechsel / cambio binario: track change
    if any(t in name for t in ("(Abzw)", "(dira)", "(Dira)", "(bif)")):
        return "junction"
    if "(Stas)" in name or "Ueberholgleis" in name or "sorpasso" in name:
        return "loop"
    return "station"


def build_topology() -> dict:
    bg = api("linie-mit-betriebspunkten", where=f"linie={BG_LINE} and km>={KM_FROM} and km<={KM_TO}", order_by="km")
    east = {p["abkurzung_bpk"]: p for p in api("linie-mit-betriebspunkten", where=f"linie={GBT_EAST}", order_by="km")}

    ops: dict[str, dict] = {}
    chain: list[str] = []
    for p in bg:
        oid = p["abkurzung_bpk"]
        # SBB lists some stations twice (two ends of the station); keep the first.
        if oid in ops or any(ops[c]["name"] == p["bezeichnung_bps"] and abs(ops[c]["kmBG"] - p["km"]) < 1.5 for c in chain):
            continue
        ops[oid] = {
            "id": oid, "name": p["bezeichnung_bps"], "kind": kind_of(p["bezeichnung_bps"]),
            "kmBG": round(p["km"], 3), "lat": round(p["geopos"]["lat"], 5), "lon": round(p["geopos"]["lon"], 5),
            "basis": "sbb-open-data:linie-mit-betriebspunkten",
        }
        chain.append(oid)
    for need in (JUNCTION_N, JUNCTION_S):
        if need not in ops:
            sys.exit(f"junction {need} not found on line {BG_LINE}")
    iN, iS = chain.index(JUNCTION_N), chain.index(JUNCTION_S)
    for i, oid in enumerate(chain):
        ops[oid]["route"] = "north" if i <= iN else ("south" if i >= iS else "BG")

    sections = []
    for a, b in zip(chain, chain[1:]):
        ra, rb = ops[a]["route"], ops[b]["route"]
        sections.append({
            # A section that crosses a route boundary belongs to the shared part.
            "id": f"{a}-{b}", "from": a, "to": b, "route": ra if ra == rb else ("north" if "north" in (ra, rb) else "south"),
            "km": round(ops[b]["kmBG"] - ops[a]["kmBG"], 3), "tracks": 2, "tracksBasis": "assumed",
            "basis": "derived:km difference on line 600",
        })

    # Base tunnel: nodes from line 595, junctions shared with the mountain line.
    gbt_chain, base_km = [], None
    for oid, bpks, name, kind in GBT_NODES:
        pts = [east[b] for b in bpks if b in east]
        if not pts:
            sys.exit(f"GBT point {bpks} not found on line {GBT_EAST}")
        km = sum(p["km"] for p in pts) / len(pts)
        base_km = km if base_km is None else base_km
        if oid not in ops:
            ops[oid] = {
                "id": oid, "name": name, "kind": kind, "route": "GBT",
                "lat": round(sum(p["geopos"]["lat"] for p in pts) / len(pts), 5),
                "lon": round(sum(p["geopos"]["lon"] for p in pts) / len(pts), 5),
                "basis": f"sbb-open-data:linie-mit-betriebspunkten (line {GBT_EAST})",
            }
        ops[oid]["kmGBT"] = round(km - base_km, 3)
        gbt_chain.append(oid)
    for a, b in zip(gbt_chain, gbt_chain[1:]):
        sections.append({
            "id": f"{a}-{b}", "from": a, "to": b, "route": "GBT", "tubes": ["GBT-W", "GBT-O"],
            "km": round(ops[b]["kmGBT"] - ops[a]["kmGBT"], 3), "tracks": 2, "tracksBasis": "one per tube",
            "basis": f"derived:km difference on line {GBT_EAST}; west tube assumed equal length",
        })
    # Pozzo Negro -> Pollegio Nord: a real connector (5806 freight trains/yr), length from coordinates.
    if "POLN" in ops:
        d = haversine_km((ops["POZZ"]["lat"], ops["POZZ"]["lon"]), (ops["POLN"]["lat"], ops["POLN"]["lon"]))
        sections.append({
            "id": "POZZ-POLN", "from": "POZZ", "to": "POLN", "route": "connector", "km": round(d, 3), "tracks": 1,
            "tracksBasis": "assumed", "basis": "derived:straight-line distance, a lower bound",
        })

    for s in sections:
        s["lengthBasis"] = s.pop("basis")
    return {
        "operatingPoints": [ops[o] for o in chain] + [ops[o] for o in gbt_chain if o not in chain],
        "sections": sections,
        "routes": {
            "BG": chain[iN:iS + 1],
            "GBT": gbt_chain,
            "north": chain[:iN + 1],
            "south": chain[iS:],
        },
        "crossovers": {
            "tubeChange": ["SED", "FAI"],
            "note": "Sedrun and Faido multifunction stations are where a train changes tube. With one tube closed, "
                    "trains run single-track between them.",
        },
    }


def freight_volumes(year: int = 2025) -> dict:
    """Annual trains per direction on a reference section of each route (SBB `zugzahlen`)."""
    refs = {"GBT": (85, "Rynächt (Abzw)", "Sedrun SMF"), "BG": (86, "Airolo", "Ambrì-Piotta")}
    out = {}
    for route, (line, frm, to) in refs.items():
        rows = api("zugzahlen", where=f"strecke_nummer={line} and jahr=date'{year}-01-01' and bp_von_abschnitt_bezeichnung='{frm}' "
                                       f"and bp_bis_abschnitt_bezeichnung='{to}'")
        per = defaultdict(list)
        for r in rows:
            per[r["geschaeftscode"]].append(r["anzahl_zuege"])
        out[route] = {
            "section": f"{frm} -> {to} (line {line})",
            "year": year,
            "perDirectionPerYear": {k: [int(x) for x in v] for k, v in per.items()},
            "perDirectionPerDay": {k: round(sum(v) / len(v) / 365, 2) for k, v in per.items()},
        }
    return out


def zr(zip_path: str, name: str):
    return subprocess.Popen(["unzip", "-p", zip_path, name], stdout=subprocess.PIPE, text=True, encoding="utf-8-sig").stdout


def secs(t: str) -> int:
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def passenger_trips(gtfs: str, date: str, topo: dict, cache: str | None = None) -> list[dict]:
    """GTFS trips that call in the stage-1 corridor on one service day.

    `cache` stores the raw calls per trip so a change to the classification does
    not mean streaming 3.7 GB again. It is keyed by service day and the station set.
    """
    stations = {fold(o["name"]): o for o in topo["operatingPoints"] if o["kind"] == "station"}
    stop2op = {}
    for r in csv.DictReader(zr(gtfs, "stops.txt")):
        o = stations.get(fold(r["stop_name"]))
        if o and not r["stop_id"].startswith("Parent"):
            stop2op[r["stop_id"]] = o["id"]
    missing = sorted(n for n in stations if n not in {fold(o["name"]) for o in topo["operatingPoints"] if o["id"] in set(stop2op.values())})
    print(f"  {len(stop2op)} GTFS stops matched; stations without GTFS stop: {missing}", file=sys.stderr)

    d = dt.datetime.strptime(date, "%Y-%m-%d")
    ds, wd = d.strftime("%Y%m%d"), ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][d.weekday()]
    active = {r["service_id"] for r in csv.DictReader(zr(gtfs, "calendar.txt")) if r["start_date"] <= ds <= r["end_date"] and r[wd] == "1"}
    for r in csv.DictReader(zr(gtfs, "calendar_dates.txt")):
        if r["date"] == ds:
            (active.add if r["exception_type"] == "1" else active.discard)(r["service_id"])
    trips = {r["trip_id"]: r for r in csv.DictReader(zr(gtfs, "trips.txt")) if r["service_id"] in active}
    routes = {r["route_id"]: r for r in csv.DictReader(zr(gtfs, "routes.txt"))}

    key = {"date": date, "ops": sorted(set(stop2op.values()))}
    cached = json.loads(Path(cache).read_text()) if cache and Path(cache).is_file() else None
    if cached and cached["key"] == key:
        calls = {t: [tuple(c) for c in cs] for t, cs in cached["calls"].items()}
        print("  calls from cache", file=sys.stderr)
    else:
        calls = defaultdict(list)
        p = zr(gtfs, "stop_times.txt")
        hdr = p.readline().strip().replace('"', "").split(",")
        ix = {h: i for i, h in enumerate(hdr)}
        for line in p:
            f = next(csv.reader([line])) if '"' in line else line.split(",")
            op = stop2op.get(f[ix["stop_id"]])
            if op and f[ix["trip_id"]] in trips:
                calls[f[ix["trip_id"]]].append((int(f[ix["stop_sequence"]]), op, secs(f[ix["arrival_time"]]), secs(f[ix["departure_time"]])))
        if cache:
            Path(cache).write_text(json.dumps({"key": key, "calls": calls}))

    km = {o["id"]: o.get("kmBG", o.get("kmGBT")) for o in topo["operatingPoints"]}
    side = {o["id"]: o["route"] for o in topo["operatingPoints"]}
    bg_only = {i for i, r in side.items() if r == "BG"}
    out = []
    for tid, cs in calls.items():
        cs = sorted(cs)
        ops_called = [c[1] for c in cs]
        if len(set(ops_called)) < 2:
            continue
        sides = {side[o] for o in ops_called}
        # Tunnel/mountain traffic runs through the middle of the corridor.
        # Mountain line: the calls must cover a real stretch between the two
        # junctions (S-Bahn pairs such as Biasca-Bellinzona touch a few km at
        # most). Base tunnel: no call on the mountain line, one on each side.
        # Everything else is kept, since it uses capacity on an approach, but
        # marked local.
        lo, hi = km[JUNCTION_N], km[JUNCTION_S]
        mid = [min(max(km[o], lo), hi) for o in ops_called if side[o] in ("north", "BG", "south")]
        covered = (max(mid) - min(mid)) if mid else 0
        if bg_only & set(ops_called):
            scope = "through" if covered >= MIN_MOUNTAIN_KM else "local"
        else:
            scope = "through" if sides >= {"north", "south"} else "local"
        direction = "S" if km[ops_called[0]] < km[ops_called[-1]] else "N"
        r = routes[trips[tid]["route_id"]]
        out.append({
            "id": tid, "category": r["route_desc"], "line": r["route_short_name"], "headsign": trips[tid]["trip_headsign"],
            "scope": scope, "direction": direction,
            "route": ("BG" if bg_only & set(ops_called) else "GBT") if scope == "through" else "local",
            "calls": [{"op": c[1], "arr": c[2], "dep": c[3]} for c in cs],
            "basis": "gtfs:opentransportdata.swiss",
        })
    out.sort(key=lambda t: t["calls"][0]["dep"])
    return out


def synthetic_freight(volumes: dict, topo: dict, seed: int = 20260704) -> list[dict]:
    """Freight trains at the published daily volume, spread evenly over the day with seeded jitter."""
    rng = random.Random(seed)
    out = []
    for route in ("GBT", "BG"):
        per_day = volumes[route]["perDirectionPerDay"].get("Gueterverkehr", 0)
        n = max(1, round(per_day))
        for direction in ("S", "N"):
            for i in range(n):
                t0 = int((i + rng.random()) * 86400 / n)
                out.append({
                    "id": f"F-{route}-{direction}-{i:02d}", "category": "Freight", "direction": direction, "route": route,
                    "entryTimeSeconds": t0, "basis": "synthetic",
                    "volumeBasis": f"sbb-open-data:zugzahlen {volumes[route]['year']} ({per_day}/day/direction, rounded to {n})",
                })
    return sorted(out, key=lambda t: t["entryTimeSeconds"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gtfs", required=True, help="path to the Swiss GTFS zip")
    ap.add_argument("--date", default="2026-10-06", help="service day (a Tuesday by default)")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--cache", help="file to keep the streamed GTFS calls in (skips the 3.7 GB pass next time)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    today = dt.date.today().isoformat()

    print("topology ...", file=sys.stderr)
    topo = build_topology()
    topo = {"id": "gotthard", "version": 1, "generated": today, "scope": "stage 1: Arth-Goldau .. Bellinzona",
            "portals": PORTALS, "speedAssumptions": SPEED_ASSUMPTIONS, **topo}
    (out / "gotthard.topology.json").write_text(json.dumps(topo, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print("freight volumes ...", file=sys.stderr)
    vols = freight_volumes()
    print("passenger trips (streams 3.7 GB, a few minutes) ...", file=sys.stderr)
    pax = passenger_trips(args.gtfs, args.date, topo, args.cache)
    freight = synthetic_freight(vols, topo)
    traffic = {"id": "gotthard", "version": 1, "generated": today, "serviceDate": args.date,
               "volumes": vols, "passenger": pax, "freight": freight,
               "note": "Passenger trips are the published timetable. Freight is synthetic: the volume is the published "
                       "annual train count, the times are spread evenly with a seeded jitter (the path catalogue is not public)."}
    (out / "gotthard.traffic.json").write_text(json.dumps(traffic, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(topo['operatingPoints'])} points, {len(topo['sections'])} sections, "
          f"{len(pax)} passenger trips ({sum(t['scope'] == 'through' for t in pax)} through), {len(freight)} freight trains -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
