"""Teacher tensors preserve metrics and provenance after releasing source rows."""
import hashlib
import json

import numpy as np
import pytest
import torch

from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA
from lab.marl import train_bc, train_ppo
from lab.marl.collect_pp_demonstrations import SCHEMA
from lab.marl.common import ActorCritic, masked_logits


def _record(action=4, case_id="train-b", weight=1.0):
    return {"schema": SCHEMA, "observation_schema": OBSERVATION_SCHEMA,
            "owner": "pp_teacher", "source": "native_strict_pp",
            "case_id": case_id, "split": "train", "step": 10, "handle": 0,
            "obs": [0.0] * 36, "mask": [1, 0, 1, 0, 1],
            "teacher_action": action, "applied_action": action, "weight": weight}


class _TrackedRecords(list):
    def __init__(self, records, released):
        super().__init__(records)
        self.released = released

    def __del__(self):
        self.released.append(True)


@pytest.mark.parametrize("training", [False, True])
def test_chunked_agreement_matches_full_forward_without_changing_rng_or_model(training):
    torch.set_num_threads(1)
    torch.manual_seed(173)
    model = ActorCritic()
    model.train(training)
    observations = torch.randn(8201, 36)
    observations[:, 4] = (torch.arange(len(observations)) % 3 == 0).float()
    observations[:, 33] = (torch.arange(len(observations)) % 7 == 0).float()
    masks = torch.ones(len(observations), 5)
    masks[:, 1] = 0
    actions = torch.tensor([0, 2, 3, 4])[torch.arange(len(observations)) % 4]
    with torch.no_grad():
        correct = masked_logits(model(observations)[0], masks).argmax(-1) == actions
    phases = {"ready": observations[:, 4] > .5,
              "ready_go": (observations[:, 4] > .5) & (actions == 2),
              "at_call": observations[:, 33] > 1.0 - 1e-6}
    expected = {"all": float(correct.float().mean()), "by_action": {
        str(action): float(correct[actions == action].float().mean())
        for action in actions.unique().tolist()
    }, "by_phase": {name: float(correct[selected].float().mean())
                    for name, selected in phases.items() if selected.any()}}
    state = {name: value.clone() for name, value in model.state_dict().items()}
    rng = torch.get_rng_state().clone()
    calls = []
    hook = model.register_forward_pre_hook(lambda _module, inputs: calls.append(len(inputs[0])))
    try:
        actual = train_bc.teacher_agreement(model, observations, masks, actions)
    finally:
        hook.remove()
    assert actual == expected
    assert calls == [8192, 9]
    assert model.training == training
    assert torch.equal(torch.get_rng_state(), rng)
    assert all(torch.equal(value, state[name]) for name, value in model.state_dict().items())


def test_bc_releases_rows_before_optimisation_and_retains_metadata(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    rows = [_record(), _record(2, "train-a", 2), _record(0, "train-a", 3), _record(weight=4)]
    rows[0]["teacher_executor"] = "trainruns"
    rows[0]["teacher_mode"] = "replan"
    rows[2]["obs"][0] = 1e-7
    rows[3]["obs"][33] = 1
    dataset = tmp_path / "teacher.jsonl"
    dataset.write_text("".join(json.dumps(row) + "\n" for row in rows))
    released = []
    original_loader = train_bc.load_demonstrations
    monkeypatch.setattr(train_bc, "load_demonstrations",
                        lambda paths: _TrackedRecords(original_loader(paths), released))
    original_randperm = torch.randperm

    def checked_randperm(*args, **kwargs):
        assert released == [True], "source rows must be released before the first epoch"
        return original_randperm(*args, **kwargs)

    monkeypatch.setattr(torch, "randperm", checked_randperm)
    result = train_bc.train(["--dataset", str(dataset), "--name", "released-bc",
                             "--epochs", "1", "--minibatch", "2", "--device", "cpu"])
    meta = result["meta"]
    assert meta["samples"] == 4
    assert meta["case_ids"] == ["train-a", "train-b"]
    assert meta["teacher_executors"] == ["schedules", "trainruns"]
    assert meta["teacher_modes"] == ["replan", "static"]
    assert meta["action_counts"] == {"0": 1, "2": 1, "4": 2}
    assert meta["sample_weight_range"] == [1.0, 4.0]
    assert meta["conflicting_observation_keys"] == 1
    assert meta["conflicting_exact_observation_keys"] == 1
    assert meta["datasets"] == [{"path": str(dataset), "sha256": hashlib.sha256(dataset.read_bytes()).hexdigest()}]
    saved = torch.load(result["checkpoint"], map_location="cpu", weights_only=False)
    assert saved["meta"]["samples"] == 4
    assert saved["meta"]["agreement_after"] == result["after"]


def test_ppo_releases_teacher_rows_before_rollout_and_preserves_anchor(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    rows = [_record(2, "train-a", 2), _record(4, "train-b", 3)]
    rows[0]["obs"][4] = 1
    dataset = tmp_path / "teacher.jsonl"
    dataset.write_text("".join(json.dumps(row) + "\n" for row in rows))
    released = []
    original_loader = train_bc.load_demonstrations
    monkeypatch.setattr(train_bc, "load_demonstrations",
                        lambda paths: _TrackedRecords(original_loader(paths), released))

    def fake_episode(_model, _scenario, _rng, _gamma, _lam, batch, stats):
        assert released == [True], "source rows must be released before rollout"
        batch.obs.append(np.zeros(36, dtype=np.float32))
        batch.mask.append(np.ones(5, dtype=np.float32))
        batch.action.append(2)
        batch.logp.append(0.0)
        batch.value.append(0.0)
        batch.advantage.append(0.0)
        batch.ret.append(0.0)
        stats.steps += 1
        stats.trains += 1
        stats.arrived += 1
        stats.returns.append(0.0)

    def checked_update(_model, _optimizer, _batch, _device, **kwargs):
        observations, masks, actions, weights = kwargs["bc_batch"]
        assert observations.shape == (2, 36)
        assert masks.tolist() == [row["mask"] for row in rows]
        assert actions.tolist() == [2, 4]
        assert weights.tolist() == [10.0, 3.0]
        return dict.fromkeys(("policy_loss", "value_loss", "entropy", "approx_kl", "clip_frac", "bc_loss"), 0.0)

    monkeypatch.setattr(train_ppo, "run_episode", fake_episode)
    monkeypatch.setattr(train_ppo, "ppo_update", checked_update)
    result = train_ppo.train(["--name", "released-ppo", "--iterations", "1", "--samples-per-iter", "1",
                              "--device", "cpu", "--bc-dataset", str(dataset), "--bc-coef", "1",
                              "--bc-decision-weight", "5"])
    meta = torch.load(result["checkpoint"], map_location="cpu", weights_only=False)["meta"]
    assert meta["bc_dataset"] == [{"path": str(dataset), "sha256": hashlib.sha256(dataset.read_bytes()).hexdigest()}]
    assert meta["hyperparameters"]["bc_decision_weight"] == 5.0
