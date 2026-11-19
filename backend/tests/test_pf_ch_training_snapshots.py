"""Development snapshots preserve training, and PPO anchors retain BC semantics."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import torch

from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA
from lab.marl.collect_pp_demonstrations import SCHEMA
from lab.marl.common import ActorCritic, load_model
from lab.marl import train_bc, train_ppo


def _record(phase: str = "ordinary", weight: float = 1.0):
    obs = [0.0] * 36
    if phase == "ready":
        obs[4] = 1.0
    if phase == "call":
        obs[33] = 1.0
    return {"schema": SCHEMA, "observation_schema": OBSERVATION_SCHEMA,
            "owner": "pp_teacher", "source": "native_strict_pp",
            "case_id": "explicit-train-case", "split": "train", "step": 10, "handle": 0,
            "obs": obs, "mask": [1, 0, 1, 0, 1], "teacher_action": 4,
            "applied_action": 4, "weight": weight}


def test_snapshot_copies_cpu_weights_without_moving_or_changing_training_model(tmp_path, monkeypatch):
    model = ActorCritic()
    model.train()
    pointers = [parameter.data_ptr() for parameter in model.parameters()]
    expected = {key: value.detach().clone() for key, value in model.state_dict().items()}

    def forbidden_move(*_args, **_kwargs):
        raise AssertionError("snapshot must not move the training model")

    monkeypatch.setattr(model, "to", forbidden_move)
    path = train_bc.save_training_snapshot(
        model, {"kind": "pp-bc", "case_ids": ["explicit-train-case"], "split": "train"},
        tmp_path, "candidate", 3,
    )
    assert model.training
    assert pointers == [parameter.data_ptr() for parameter in model.parameters()]
    payload = torch.load(path, map_location="cpu", weights_only=True)
    assert set(payload) == {"model", "meta"}
    assert payload["meta"]["epochs_completed"] == 3
    assert payload["meta"]["obs_size"] == 36
    assert payload["meta"]["observation_schema"] == OBSERVATION_SCHEMA
    assert payload["meta"]["case_ids"] == ["explicit-train-case"]
    assert json.loads(path.with_suffix(".json").read_text()) == payload["meta"]
    assert all(value.device.type == "cpu" and not value.requires_grad for value in payload["model"].values())
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.add_(1)
    assert all(torch.equal(payload["model"][key], value) for key, value in expected.items())


def test_periodic_snapshots_preserve_final_fit_and_provenance(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    dataset = tmp_path / "teacher.jsonl"
    dataset.write_text("".join(json.dumps(_record()) + "\n" for _ in range(8)))
    common = ["--dataset", str(dataset), "--epochs", "3", "--minibatch", "4",
              "--device", "cpu", "--threads", "1", "--seed", "11"]
    ordinary = train_bc.train(["--name", "ordinary", *common])
    directory = tmp_path / "snapshots"
    archived = train_bc.train(["--name", "archived", *common,
                               "--save-every", "2", "--snapshot-dir", str(directory)])
    for key, value in load_model(ordinary["checkpoint"]).state_dict().items():
        assert torch.equal(value, load_model(archived["checkpoint"]).state_dict()[key])
    files = sorted(directory.glob("*.pt"))
    assert [path.name for path in files] == ["archived-epoch-00002.pt", "archived-epoch-00003.pt"]
    snapshot = torch.load(files[0], map_location="cpu", weights_only=True)
    assert snapshot["meta"]["epochs_completed"] == 2
    assert snapshot["meta"]["hyperparameters"]["epochs"] == 3
    assert snapshot["meta"]["datasets"][0]["sha256"] == hashlib.sha256(dataset.read_bytes()).hexdigest()
    assert snapshot["meta"]["source_sha256"]["lab/marl/train_bc.py"] == hashlib.sha256(Path(train_bc.__file__).read_bytes()).hexdigest()
    assert snapshot["meta"]["teacher_source"] == "native_strict_pp"
    final = torch.load(archived["checkpoint"], map_location="cpu", weights_only=False)
    assert "optimizer" in final
    assert "snapshot" not in final["meta"]
    assert not list(directory.glob("*.tmp"))


@pytest.mark.parametrize("flags", [
    ["--save-every", "-1"], ["--save-every", "2"], ["--snapshot-dir", "missing-interval"],
])
def test_incomplete_snapshot_options_fail_before_loading_teacher_data(flags):
    with pytest.raises(ValueError, match="save-every"):
        train_bc.train(["--name", "must-not-write", "--dataset", "nonexistent.jsonl", *flags])


def test_ppo_anchor_uses_requested_focal_objective():
    torch.set_num_threads(1)
    torch.manual_seed(7)
    model = ActorCritic()
    observations = torch.zeros(1, 36)
    masks = torch.ones(1, 5)
    actions, weights = torch.tensor([2]), torch.tensor([3.0])
    with torch.no_grad():
        logits, values = model(observations)
        logp = logits.log_softmax(-1)[:, 2]
    batch = train_ppo.Batch(obs=list(observations.numpy()), mask=list(masks.numpy()),
                            action=[2], logp=logp.tolist(), value=values.tolist(),
                            advantage=[0.0], ret=values.tolist())
    anchor = (observations, masks, actions, weights)
    expected = float(train_bc.imitation_loss(model, *anchor, focal_gamma=2.0).detach())
    optimizer = torch.optim.SGD(model.parameters(), lr=0.0)
    result = train_ppo.ppo_update(
        model, optimizer, batch, torch.device("cpu"), epochs=1, minibatch=1,
        clip=.2, value_coef=0.0, entropy_coef=0.0, max_grad_norm=1.0,
        bc_batch=anchor, bc_coef=1.0, bc_focal_gamma=2.0,
    )
    assert result["bc_loss"] == pytest.approx(expected)


def test_ppo_train_applies_critical_weights_and_records_anchor_recipe(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    dataset = tmp_path / "teacher.jsonl"
    dataset.write_text("".join(json.dumps(row) + "\n" for row in
                               [_record("ready", 2), _record("call", 3), _record("ordinary", 4)]))
    captured = {}

    def fake_episode(_model, _scenario, _rng, _gamma, _lam, batch, stats):
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

    def capture_update(_model, _optimizer, _batch, _device, **kwargs):
        captured.update(kwargs)
        return dict.fromkeys(("policy_loss", "value_loss", "entropy", "approx_kl", "clip_frac", "bc_loss"), 0.0)

    monkeypatch.setattr(train_ppo, "run_episode", fake_episode)
    monkeypatch.setattr(train_ppo, "ppo_update", capture_update)
    result = train_ppo.train([
        "--name", "anchor", "--iterations", "1", "--samples-per-iter", "1",
        "--device", "cpu", "--bc-dataset", str(dataset), "--bc-coef", "2",
        "--bc-decision-weight", "10", "--bc-focal-gamma", "2",
    ])
    assert captured["bc_batch"][3].tolist() == [20.0, 30.0, 4.0]
    assert captured["bc_focal_gamma"] == 2.0
    meta = torch.load(result["checkpoint"], map_location="cpu", weights_only=False)["meta"]
    assert meta["hyperparameters"]["bc_decision_weight"] == 10.0
    assert meta["hyperparameters"]["bc_focal_gamma"] == 2.0


@pytest.mark.parametrize("flags", [
    ["--bc-decision-weight", "0.5"], ["--bc-focal-gamma", "-1"],
    ["--bc-decision-weight", "nan"], ["--bc-focal-gamma", "inf"],
])
def test_ppo_rejects_invalid_anchor_coefficients_before_loading_model(flags):
    with pytest.raises(ValueError):
        train_ppo.train(["--name", "must-not-write", *flags])
