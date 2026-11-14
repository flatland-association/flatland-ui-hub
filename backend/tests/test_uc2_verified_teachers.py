"""Honest mixed teacher provenance and verified native UC2-3 supervision."""
import json

import pytest

from lab.marl.collect_pp_demonstrations import load_demonstrations
from lab.marl.collect_uc2_verified_teachers import collect_dla_case, prefer_dla
from lab.marl.pf_ch_episode import PFChCase
from lab.marl.train_bc import teacher_provenance


def _record(dla=False):
    row={"schema":"pf-ch-pp-v2","owner":"pp_teacher","source":"native_strict_pp",
         "split":"train","case_id":"train-case","observation_schema":"uc2-context-v1",
         "obs":[0.0]*313,"mask":[1,0,1,0,1],"teacher_action":2,"applied_action":2,"weight":1.0}
    if dla:
        row.update(schema="uc2-verified-teacher-v1",owner="verified_teacher",source="native_verified_dla",
            preset="uc2-3",teacher_executor="dla",proof_sha256="a"*64,
            proof_scope="native_full_mission",mission_verified=True)
    return row


def _write(path,rows):
    path.write_text("".join(json.dumps(row)+"\n" for row in rows))


def test_loader_accepts_honest_mixed_sources_and_bc_reports_both(tmp_path):
    path=tmp_path/"mixed.jsonl"
    _write(path,[_record(),_record(True)])
    rows=load_demonstrations([path])
    meta=teacher_provenance(rows)
    assert meta["kind"] == "verified-teacher-bc"
    assert meta["teacher_source"] == "mixed_verified_teachers"
    assert meta["teacher_sources"] == ["native_strict_pp","native_verified_dla"]
    assert meta["teacher_source_counts"] == {"native_strict_pp":1,"native_verified_dla":1}
    old=teacher_provenance([_record()])
    assert old["kind"] == "pp-bc" and old["teacher_source"] == "native_strict_pp"


@pytest.mark.parametrize("change",[
    {"schema":"pf-ch-pp-v2"},{"owner":"pp_teacher"},{"source":"native_strict_pp"},
    {"split":"validation"},{"split":"test"},{"preset":"uc2-1"},
    {"teacher_executor":"trainruns"},{"mission_verified":False},{"mission_verified":1},
    {"proof_scope":"short_prefix"},{"proof_sha256":""},{"proof_sha256":"x"*64},
    {"observation_schema":"ecml36-service-v1"},{"applied_action":4},
    {"teacher_action":1,"applied_action":1},{"obs":[float("nan")]*313},{"weight":0},
])
def test_dla_cannot_masquerade_as_pp_or_bypass_proof_schema_and_action_guards(tmp_path,change):
    path=tmp_path/"bad.jsonl"
    _write(path,[{**_record(True),**change}])
    with pytest.raises(ValueError):
        load_demonstrations([path])


def test_old_pp_owner_source_guard_is_unchanged(tmp_path):
    path=tmp_path/"bad-pp.jsonl"
    _write(path,[{**_record(),"source":"native_verified_dla"}])
    with pytest.raises(ValueError):
        load_demonstrations([path])


@pytest.mark.parametrize("dla,proof,choose",[
    ({"complete_mission":True,"lateness":39},{"accepted":True},True),
    ({"complete_mission":True,"lateness":50},{"accepted":True},False),
    ({"complete_mission":False,"lateness":0},{"accepted":True},False),
    ({"complete_mission":True,"lateness":39},{"accepted":False},False),
])
def test_lower_lateness_never_overrides_full_mission_or_proof(dla,proof,choose):
    assert prefer_dla({"complete_mission":True,"lateness":50},dla,proof) is choose


def test_native_uc2_3_dla_is_fully_proved_and_live_executed():
    rows,report=collect_dla_case(PFChCase(preset="uc2-3",case_id="train-verified-dla-native"))
    assert report["accepted"] and report["proof"]["accepted"]
    assert report["metrics"]["complete_mission"] and report["metrics"]["arrived"] == 3
    assert report["metrics"]["lateness"] == 39
    assert report["metrics"]["native_on_map_positive_counter_steps"] == 7
    assert len(report["proof_sha256"]) == 64
    assert rows and all(row["source"] == "native_verified_dla" and row["preset"] == "uc2-3" for row in rows)
    assert all(row["teacher_action"] == row["applied_action"] for row in rows)


def test_failed_native_proof_admits_no_dla_rows(monkeypatch):
    from types import SimpleNamespace
    import lab.marl.collect_uc2_verified_teachers as module
    rejected=SimpleNamespace(accepted=False,to_dict=lambda:{"accepted":False,"reason":"incomplete"})
    monkeypatch.setattr(module,"validate_execution",lambda *a,**k:rejected)
    rows,report=collect_dla_case(PFChCase(preset="uc2-3",case_id="train-failed-dla"))
    assert rows == [] and not report["accepted"] and report["reason"] == "native_proof_rejected"
