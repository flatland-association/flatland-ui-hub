#!/usr/bin/env python3
"""Workshop results: the questionnaire scores of the `ws-*` conditions, per concept.

For Part 3 of the workshop (docs/workshop/facilitator-guide.md): run it while the
room fills in the last questionnaire, and show the table.

It reads the session records the study sink stored
(docs/experiment-logging.md), either from a folder or from a running server:

    python scripts/workshop_results.py backend/data/study-records
    STUDY_ADMIN_TOKEN=... python scripts/workshop_results.py https://<space>.hf.space
    python scripts/workshop_results.py backend/data/study-records --csv results.csv
    STUDY_ADMIN_TOKEN=... python scripts/workshop_results.py https://<space>.hf.space --save backup/

`--save` keeps the raw records as `<folder>/<session id>.json`. Use it before
the server restarts: a Hugging Face Space loses its disk then.

Scores are computed as `frontend/src/app/core/survey/survey-scoring.ts` does:
NASA-TLX raw (mean of six scales, 5..100), Jian trust (mean of twelve items,
1..7, items 7-10 reversed), perceived understanding (mean of two, item 2
reversed). A scale with an unanswered item has no score.

Standard library only, so it runs on any laptop.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
import urllib.request
from pathlib import Path
from typing import Any, Iterable, Optional

CONCEPT = {"recommendation": "Supportive AI (Recommendation)", "co-learning": "Co-Learning AI"}
TLX = ["tlx_mental", "tlx_physical", "tlx_temporal", "tlx_performance", "tlx_effort", "tlx_frustration"]
TRUST = [f"trust_{n}" for n in range(1, 13)]
TRUST_REVERSED = {"trust_7", "trust_8", "trust_9", "trust_10"}
UNDERSTANDING = ["und_1", "und_2"]
UNDERSTANDING_REVERSED = {"und_2"}
MODE_ITEMS = {"recommendation": ["rec_useful", "rec_followed"], "co-learning": ["col_learned", "col_reflect"]}

MEASURES = [
    ("tlx", "Workload (NASA-TLX raw, 5-100, lower is better)"),
    ("trust", "Trust (Jian, 1-7)"),
    ("understanding", "Understanding (perceived, 1-7)"),
    ("delay", "Total delay at the end (steps, lower is better)"),
    ("decisions", "Decisions taken"),
]


def read_folder(folder: Path) -> Iterable[dict[str, Any]]:
    for path in sorted([*folder.glob("*/*/record.json"), *folder.glob("*.json")]):
        try:
            yield json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print(f"skipped (unreadable): {path}", file=sys.stderr)


def read_server(base: str, token: str) -> Iterable[dict[str, Any]]:
    def get(path: str) -> Any:
        request = urllib.request.Request(base.rstrip("/") + path, headers={"X-Study-Token": token})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    for row in get("/study/records"):
        if str(row.get("conditionId") or "").startswith("ws-"):
            yield get(f"/study/records/{row['sessionId']}")


def mean_of(answers: dict[str, Any], items: list[str], reversed_items: set[str] = frozenset(), top: int = 8) -> Optional[float]:
    values = []
    for item in items:
        raw = answers.get(item)
        if not isinstance(raw, (int, float)) or isinstance(raw, bool):
            return None
        values.append(top - raw if item in reversed_items else raw)
    return sum(values) / len(values)


def row_of(record: dict[str, Any]) -> Optional[dict[str, Any]]:
    header = record.get("header") or {}
    condition = str(header.get("conditionId") or "")
    if not condition.startswith("ws-"):
        return None
    answers: dict[str, Any] = {}
    for survey in record.get("surveys") or []:
        answers.update(survey.get("answers") or {})
    outcome = record.get("outcome") or {}
    mode = header.get("mode")
    row = {
        "participant": header.get("participantId") or "",
        "condition": condition,
        "group": condition[3:4].upper(),
        "position": condition[4:5],
        "mode": mode,
        "session": header.get("sessionId"),
        "answered": bool(answers),
        "tlx": mean_of(answers, TLX),
        "trust": mean_of(answers, TRUST, TRUST_REVERSED),
        "understanding": mean_of(answers, UNDERSTANDING, UNDERSTANDING_REVERSED),
        "delay": outcome.get("totalDelay"),
        "arrived": outcome.get("arrived"),
        "decisions": len(record.get("decisions") or []),
    }
    for item in MODE_ITEMS.get(mode, []):
        row[item] = answers.get(item)
    for key in ("open_best", "open_worst"):
        row[key] = answers.get(key) or ""
    return row


def fmt(values: list[float]) -> str:
    if not values:
        return "–"
    if len(values) == 1:
        return f"{values[0]:.1f} (n=1)"
    return f"{statistics.mean(values):.1f} ± {statistics.stdev(values):.1f} (n={len(values)})"


def report(rows: list[dict[str, Any]]) -> str:
    # One run per participant and condition: the last one with answers wins,
    # so a restarted run does not count twice.
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["participant"] or row["session"], row["condition"])
        if row["answered"] or key not in latest:
            latest[key] = row
    runs = list(latest.values())

    lines = [f"Runs: {len(runs)} ({sum(r['answered'] for r in runs)} with a questionnaire)", ""]
    per_condition = {c: sum(r["condition"] == c for r in runs) for c in sorted({r["condition"] for r in runs})}
    lines += [f"  {c}: {n}" for c, n in per_condition.items()] + [""]

    lines += ["| Measure | " + " | ".join(CONCEPT.values()) + " | Paired difference (Co-Learning − Supportive) |", "|---|---|---|---|"]
    by_participant: dict[str, dict[str, dict[str, Any]]] = {}
    for r in runs:
        if r["participant"]:
            by_participant.setdefault(r["participant"], {})[r["mode"]] = r
    for key, label in MEASURES:
        cells = [fmt([r[key] for r in runs if r["mode"] == mode and r[key] is not None]) for mode in CONCEPT]
        diffs = [
            pair["co-learning"][key] - pair["recommendation"][key]
            for pair in by_participant.values()
            if len(pair) == 2 and pair["co-learning"][key] is not None and pair["recommendation"][key] is not None
        ]
        lines.append(f"| {label} | {cells[0]} | {cells[1]} | {fmt(diffs)} |")

    lines += ["", "Mode items (1-7):"]
    for mode, items in MODE_ITEMS.items():
        for item in items:
            lines.append(f"  {item}: {fmt([r[item] for r in runs if r['mode'] == mode and isinstance(r.get(item), (int, float))])}")

    lines += ["", "Order effect, workload (NASA-TLX) by position:"]
    for position in ("1", "2"):
        for mode, name in CONCEPT.items():
            values = [r["tlx"] for r in runs if r["position"] == position and r["mode"] == mode and r["tlx"] is not None]
            lines.append(f"  run {position}, {name}: {fmt(values)}")

    for key, title in (("open_best", "What worked best"), ("open_worst", "What was hardest")):
        lines += ["", f"{title}:"]
        for mode, name in CONCEPT.items():
            for r in runs:
                if r["mode"] == mode and r[key]:
                    lines.append(f"  [{name}] {r[key]}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source", help="folder with study records, or the server's base URL")
    parser.add_argument("--csv", help="also write one row per run to this file")
    parser.add_argument("--save", help="also keep every raw ws-* record in this folder")
    args = parser.parse_args()

    if args.source.startswith(("http://", "https://")):
        token = os.environ.get("STUDY_ADMIN_TOKEN", "")
        if not token:
            sys.exit("set STUDY_ADMIN_TOKEN to read records from a server")
        records = read_server(args.source, token)
    else:
        folder = Path(args.source)
        if not folder.is_dir():
            sys.exit(f"no such folder: {folder}")
        records = read_folder(folder)

    records = list(records)
    rows = [row for row in (row_of(record) for record in records) if row]
    if args.save:
        target = Path(args.save)
        target.mkdir(parents=True, exist_ok=True)
        kept = 0
        for record in records:
            header = record.get("header") or {}
            if str(header.get("conditionId") or "").startswith("ws-") and header.get("sessionId"):
                (target / f"{header['sessionId']}.json").write_text(json.dumps(record), encoding="utf-8")
                kept += 1
        print(f"kept {kept} raw records in {target}\n")
    if not rows:
        sys.exit("no ws-* records found")
    print(report(rows))
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=sorted({k for row in rows for k in row}))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nwrote {len(rows)} rows to {args.csv}")


if __name__ == "__main__":
    main()
