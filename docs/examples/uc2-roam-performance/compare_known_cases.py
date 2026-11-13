"""Portable casewise lateness/makespan evidence; reads JSON only, never rolls out."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
ROAM = HERE.parent / "uc2-roam"
COHORTS = ("exact5", "dev20", "historical50", "new50")
EXPECTED_CHECKPOINT = "01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668"


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path = Path(path)
    if path.exists():
        if read(path) == value:
            return
        raise FileExistsError(f"refusing to replace differing evidence: {path.name}")
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def physical(case):
    preset = case["preset"]
    return preset, tuple(case.get("departure_offsets") or (0,) * (2 if preset == "tutorial" else 3))


def v2_rows():
    sources, rows = {}, []
    for cohort in COHORTS:
        path = ROAM / f"{cohort}-comparison.json"
        report = read(path)
        assert report["inputs"]["checkpoint_sha256"] == EXPECTED_CHECKPOINT
        sources[cohort] = {"path": str(path.relative_to(ROOT)), "sha256": digest(path)}
        rows.extend({**row, "cohort": cohort} for row in report["results"] if row["policy"] == "v2")
    assert len(rows) == 125 and len({r["case_id"] for r in rows}) == 125
    return sources, rows


def normalize(row, canonical, source_name):
    return {"case_id": canonical["case_id"], "cohort": canonical["cohort"],
            "preset": canonical["case"]["preset"], "departure_offsets": list(physical(canonical["case"])[1]),
            "complete": bool(row.get("complete_mission", row.get("complete"))),
            "arrived": row["arrived"], "trains": row.get("total", row.get("trains")),
            "lateness": row["lateness"], "makespan": row.get("steps", row.get("finish_step")),
            "horizon": row["horizon"], "method": "pp-trainruns-replan",
            "source_artifact": source_name, "original_case_id": row["case_id"]}


def assemble_pp(exact_path, dev_path):
    sources, baseline = v2_rows()
    inputs = {"exact5": Path(exact_path), "dev20": Path(dev_path),
              "historical50": ROAM / "historical50-pp-reference.json",
              "new50": ROAM / "confirmation50-pp-reference.json"}
    records, provenance = [], {}
    for cohort, path in inputs.items():
        data = read(path)
        pp = [r for r in data.get("results", data.get("rows", []))
              if r["policy"] == "pp-trainruns-replan"]
        canonical = [r for r in baseline if r["cohort"] == cohort]
        assert len(pp) == len(canonical)
        by_key = {physical(r["case"]): r for r in pp if "case" in r}
        by_id = {r["case_id"]: r for r in pp}
        for v2 in canonical:
            old = by_key[physical(v2["case"])] if by_key else by_id[v2["case_id"]]
            assert old["horizon"] == v2["horizon"]
            records.append(normalize(old, v2, path.name))
        provenance[cohort] = {"artifact_name": path.name, "sha256": digest(path),
            "raw_source_in_this_package": cohort in ("historical50", "new50"),
            "compact_all_case_metrics_published": True}
    report = {"schema": "uc2-pp-reference-known125-v1", "cases": 125,
              "scope": "Archived native fixed PP references; full125case metrics, no new rollout or selection.",
              "method": {"policy": "pp-trainruns-replan", "max_priority_orders": 4,
                         "max_incident_replans": 8, "selection": "First natively valid priority candidate, not global lateness optimum"},
              "cohort_sources": provenance, "v2_sources_for_physical_identity": sources, "records": records}
    out = HERE / "pp-reference-known125.json"
    write(out, report)
    print(json.dumps({"artifact": out.name, "sha256": digest(out), "cases": len(records)}))


def metrics(rows, name):
    return {"cases": len(rows), "complete": sum(r[name]["complete"] for r in rows),
            "arrived": sum(r[name]["arrived"] for r in rows),
            "trains": sum(r[name]["trains"] for r in rows),
            "lateness": sum(r[name]["lateness"] for r in rows),
            "lateness_better": sum(r[name]["lateness_gap_vs_pp"] < 0 for r in rows),
            "lateness_equal": sum(r[name]["lateness_gap_vs_pp"] == 0 for r in rows),
            "lateness_worse": sum(r[name]["lateness_gap_vs_pp"] > 0 for r in rows),
            "sum_positive_lateness_gap": sum(max(0, r[name]["lateness_gap_vs_pp"]) for r in rows),
            "worst_lateness_gap": max(r[name]["lateness_gap_vs_pp"] for r in rows),
            "makespan_better": sum(r[name]["makespan_gap_vs_pp"] < 0 for r in rows),
            "makespan_equal": sum(r[name]["makespan_gap_vs_pp"] == 0 for r in rows),
            "makespan_worse": sum(r[name]["makespan_gap_vs_pp"] > 0 for r in rows),
            "sum_positive_makespan_gap": sum(max(0, r[name]["makespan_gap_vs_pp"]) for r in rows),
            "worst_makespan_gap": max(r[name]["makespan_gap_vs_pp"] for r in rows),
            "nonworse_both_metrics": sum(r[name]["lateness_gap_vs_pp"] <= 0 and r[name]["makespan_gap_vs_pp"] <= 0 for r in rows)}


def join(candidate_path, tag, prior_path=None, disposition="experimental",
         expected_candidate_checkpoint=EXPECTED_CHECKPOINT, expected_candidate_bundle=None):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", tag):
        raise ValueError("tag must be a portable filename component")
    reference_path = HERE / "pp-reference-known125.json"
    refs = read(reference_path)
    sources, baseline = v2_rows()
    v2 = {r["case_id"]: r for r in baseline}
    source = read(candidate_path)
    if expected_candidate_bundle is not None:
        if not re.fullmatch(r"[a-f0-9]{64}", expected_candidate_bundle):
            raise ValueError("candidate bundle hash must contain 64 lowercase hex characters")
        assert source["inputs"]["bundle_manifest_sha256"] == expected_candidate_bundle
        model_hashes = source["inputs"]["model_sha256"]
        assert set(model_hashes) == {r["case"]["preset"] for r in baseline}
        assert all(re.fullmatch(r"[a-f0-9]{64}", h) for h in model_hashes.values())
        candidate_checkpoint = None
        identity_kind = "multi-model-bundle"
    else:
        if not re.fullmatch(r"[a-f0-9]{64}", expected_candidate_checkpoint):
            raise ValueError("candidate checkpoint hash must contain 64 lowercase hex characters")
        assert source["inputs"]["checkpoint_sha256"] == expected_candidate_checkpoint, "candidate weights differ from explicit expected hash"
        model_hashes = None
        candidate_checkpoint = expected_candidate_checkpoint
        identity_kind = "single-checkpoint"
    if not source.get("source_commit") or not source.get("source_sha256"):
        raise ValueError("candidate report requires source_commit and source_sha256 provenance")
    candidate = {r["case_id"]: r for r in source["results"]}
    assert len(source["results"]) == len(candidate) == 125 and set(candidate) == set(v2)
    policy_ids = sorted({r["policy"] for r in candidate.values()})
    assert len(policy_ids) == 1
    outcome_parity = None
    if prior_path:
        old = {r["case_id"]: r for r in read(prior_path)["results"]}
        fields = ("complete_mission", "arrived", "total", "lateness", "steps", "horizon")
        differences = [{"case_id": k, "field": f} for k, new in candidate.items()
                       for f in fields if new[f] != old[k][f]]
        outcome_parity = {"fields_per_case": len(fields), "case_count": 125,
                          "differing_fields": differences, "prior_sha256": digest(prior_path)}
        assert not differences, "audit-only rerun changed physical outcomes"
    rows = []
    for pp in refs["records"]:
        case_id = pp["case_id"]
        a, b = v2[case_id], candidate[case_id]
        assert physical(a["case"]) == physical(b["case"])
        assert a["horizon"] == b["horizon"] == pp["horizon"]
        assert a["total"] == b["total"] == pp["trains"]
        if model_hashes is not None:
            assert b["selected_infrastructure"] == pp["preset"]
            assert b["checkpoint_sha256"] == model_hashes[pp["preset"]]
        row = {"case_id": case_id, "cohort": pp["cohort"], "preset": pp["preset"],
               "departure_offsets": pp["departure_offsets"], "horizon": pp["horizon"], "pp": pp}
        for name, result in (("v2", a), ("candidate", b)):
            row[name] = {"policy": result["policy"], "complete": result["complete_mission"],
                         "arrived": result["arrived"], "trains": result["total"],
                         "lateness": result["lateness"], "makespan": result["steps"],
                         "lateness_gap_vs_pp": result["lateness"] - pp["lateness"],
                         "makespan_gap_vs_pp": result["steps"] - pp["makespan"]}
            if name == "candidate" and model_hashes is not None:
                row[name]["selected_model"] = {"infrastructure": result["selected_infrastructure"],
                    "checkpoint_sha256": result["checkpoint_sha256"], "checkpoint_file": result["checkpoint_file"]}
        rows.append(row)
    summary = {cohort: {name: metrics([r for r in rows if r["cohort"] == cohort], name)
                         for name in ("v2", "candidate")} for cohort in COHORTS}
    summary["all125"] = {name: metrics(rows, name) for name in ("v2", "candidate")}
    audits = {field: sum(r.get(field, 0) for r in candidate.values()) for field in
              ("reference_disagreements", "new_stuck_steps", "uncertified_steps", "prediction_mismatches",
               "prediction_mismatches_with_new_fault", "resource_conflicts", "planner_interventions")}
    report = {"schema": "uc2-roam-performance-known125-casewise-v1", "candidate_tag": tag,
              "candidate_policy": policy_ids[0], "checkpoint_sha256": candidate_checkpoint,
              "baseline_checkpoint_sha256": EXPECTED_CHECKPOINT,
              "candidate_checkpoint_sha256": candidate_checkpoint,
              "candidate_bundle_manifest_sha256": expected_candidate_bundle,
              "candidate_identity_kind": identity_kind, "candidate_model_sha256": model_hashes,
              "candidate_input_identity": source["inputs"],
              "comparison_script_version": 3,
              "disposition": disposition, "declared_motion_logit_bias": source.get("motion_logit_bias", 0.0),
              "variant_descriptions": source.get("variant_descriptions", {}),
              "candidate_source_commit": source["source_commit"], "candidate_source_sha256": source["source_sha256"],
              "candidate_raw_artifact_sha256": digest(candidate_path), "pp_reference_sha256": digest(reference_path),
              "v2_sources": sources, "comparison_script_sha256": digest(__file__),
              "audit_only_rerun_outcome_parity": outcome_parity, "candidate_audit_counters": audits,
              "technical_errors": [{"case_id": r["case_id"], "error": r["technical_error"]}
                                   for r in candidate.values() if "technical_error" in r],
              "scope": "Known125aredevelopment/regressioninputs, not fresh confirmation. All outcomes retained. Lateness and makespan reported separately; no universal non-regression guarantee.",
              "primary_casewise_gate": "Every PP-complete case must complete and have lateness<=that frozen PP reference. Makespan is reported separately.",
              "summary": summary,
              "by_preset": {p: {name: metrics([r for r in rows if r["preset"] == p], name) for name in ("v2", "candidate")}
                            for p in sorted({r["preset"] for r in rows})},
              "candidate_lateness_regressions": [r for r in rows if r["candidate"]["lateness_gap_vs_pp"] > 0],
              "candidate_makespan_regressions": [r for r in rows if r["candidate"]["makespan_gap_vs_pp"] > 0],
              "records": rows}
    out = HERE / f"known125-v2-vs-{tag}-vs-pp.json"
    write(out, report)
    print(json.dumps({"artifact": out.name, "sha256": digest(out), "summary": summary["all125"], "audits": audits}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    pp = sub.add_parser("pp-references")
    pp.add_argument("--exact", type=Path, required=True)
    pp.add_argument("--dev", type=Path, required=True)
    compare = sub.add_parser("join")
    compare.add_argument("--candidate", type=Path, required=True)
    compare.add_argument("--tag", required=True)
    compare.add_argument("--prior-candidate", type=Path)
    identity = compare.add_mutually_exclusive_group()
    identity.add_argument("--candidate-checkpoint-sha", default=EXPECTED_CHECKPOINT,
                         help="Explicit expected trained checkpoint SHA256; baseline V2 always remains 01b")
    identity.add_argument("--candidate-bundle-sha", help="Expected multi-model manifest SHA256, never a checkpoint hash")
    compare.add_argument("--disposition", choices=("baseline", "experimental", "rejected"), default="experimental")
    args = parser.parse_args()
    if args.command == "pp-references":
        assemble_pp(args.exact, args.dev)
    else:
        join(args.candidate, args.tag, args.prior_candidate, args.disposition, args.candidate_checkpoint_sha, args.candidate_bundle_sha)


if __name__ == "__main__":
    main()
