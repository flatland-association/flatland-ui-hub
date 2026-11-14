"""Portable model evidence must keep failures and the pre-test selection lock."""
import copy

import pytest

from app.policies.learned import uc2_bundle
from lab.marl.export_uc2_bundle import final_evidence


def _evidence():
    rows = [{"case_id": f"test-{scene}-{i}", "case": {"preset": scene}, "policy": "actor",
             "complete_mission": not (scene == "uc2-1" and i < 2),
             "arrived": 2 if scene == "tutorial" else 3, "total": 2 if scene == "tutorial" else 3,
             "lateness": i, "planner_interventions": 0,
             "observed_malfunction_counter_increases": [{"handle": 0}]}
            for scene in uc2_bundle.SCENARIOS for i in range(10)]
    report = {"manifest_sha256": "test-input", "checkpoints": {"actor": {"sha256": "frozen-model"}}, "results": rows}
    selection = {"checkpoint_sha256": "frozen-model", "final_outcomes_opened_at_selection": False,
                 "reserved_final_manifest_sha256": "test-input"}
    return report, selection


def test_final_export_keeps_all_fifty_outcomes_including_failures():
    report, lock = _evidence()
    result = final_evidence(report, lock, "frozen-model")
    assert result["cases"] == 50 and result["complete_missions"] == 48
    assert result["failed_cases"] == ["test-uc2-1-0", "test-uc2-1-1"]
    assert result["observed_native_counter_increases"] == 50
    assert result["lateness"] == sum(row["lateness"] for row in report["results"])


@pytest.mark.parametrize("field,value", [("checkpoint_sha256", "other"),
    ("final_outcomes_opened_at_selection", True), ("reserved_final_manifest_sha256", "other")])
def test_final_export_rejects_mismatched_or_posthoc_selection(field, value):
    report, lock = _evidence()
    lock[field] = value
    with pytest.raises(ValueError, match="frozen before"):
        final_evidence(report, lock, "frozen-model")


@pytest.mark.parametrize("mutation", ["drop-failure", "duplicate", "planner"])
def test_final_export_rejects_filtered_repeated_or_assisted_evidence(mutation):
    report, lock = _evidence()
    if mutation == "drop-failure":
        report["results"].pop(10)
    elif mutation == "duplicate":
        report["results"][1] = copy.deepcopy(report["results"][0])
    else:
        report["results"][1]["planner_interventions"] = 1
    with pytest.raises(ValueError, match="all fifty"):
        final_evidence(report, lock, "frozen-model")
