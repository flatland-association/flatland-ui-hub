"""Wider fixed-schema MLPs preserve the old function and remain loadable."""

import copy
from collections import OrderedDict
import numpy as np
import pytest
import torch
import torch.nn.functional as F
from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA
from app.policies.learned import learned_ppo_policy as runtime
from lab.marl.common import ActorCritic, load_model, save_checkpoint
from lab.marl import train_ppo


@pytest.fixture(autouse=True)
def one_torch_thread():
    torch.set_num_threads(1)


def _write(path, model, *, metadata=True):
    meta = {"observation_schema": model.observation_schema, "obs_size": model.trunk[0].in_features} if metadata else {}
    torch.save({"model": model.state_dict(), "meta": meta}, path)
    return path


@pytest.mark.parametrize("width,expected", [(128, 70677), (256, 206869), (384, 408597)])
def test_supported_width_shapes_and_parameter_counts(width, expected):
    model = ActorCritic(obs_size=272, hidden_size=width)
    assert runtime.checkpoint_hidden_size({"model": model.state_dict()}) == width
    assert sum(parameter.numel() for parameter in model.parameters()) == expected


@pytest.mark.parametrize("inputs", [36, 272])
@pytest.mark.parametrize("width", [256, 384])
def test_warmstart_preserves_logits_values_and_experience_outputs(tmp_path, inputs, width):
    torch.manual_seed(13)
    base = ActorCritic(obs_size=inputs)
    base.observation_schema = "pf-ch-context-v1" if inputs == 272 else OBSERVATION_SCHEMA
    widened = load_model(_write(tmp_path / "base.pt", base), hidden_size=width)
    features = torch.randn(12, inputs)
    with torch.no_grad():
        before, after = base.forward_with_experience(features), widened.forward_with_experience(features)
    assert all(torch.allclose(a, e, atol=1e-5, rtol=1e-5) for a, e in zip(after, before, strict=True))
    assert widened.trunk[0].out_features == width
    assert torch.count_nonzero(widened.trunk[2].weight[:128, 128:]) == 0
    assert torch.count_nonzero(widened.policy_head.weight[:, 128:]) == 0
    assert torch.count_nonzero(widened.trunk[0].weight[128:]) > 0


def test_width_and_input_extension_preserve_legacy_function_together(tmp_path):
    torch.manual_seed(3)
    base = ActorCritic()
    model = load_model(
        _write(tmp_path / "base.pt", base), obs_size=272, observation_schema="pf-ch-context-v1", hidden_size=256
    )
    old = torch.randn(6, 36)
    extended = torch.cat((old, torch.randn(6, 236)), dim=1)
    with torch.no_grad():
        expected, actual = base.forward_with_experience(old), model.forward_with_experience(extended)
    assert all(torch.allclose(a, e, atol=1e-5, rtol=1e-5) for a, e in zip(actual, expected, strict=True))


def test_new_units_receive_learning_signal_after_function_preserving_start(tmp_path):
    torch.manual_seed(9)
    model = load_model(_write(tmp_path / "base.pt", ActorCritic()), hidden_size=256)
    features, labels = torch.randn(16, 36), torch.arange(16) % 5
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    assert torch.count_nonzero(model.policy_head.weight[:, 128:]) == 0
    F.cross_entropy(model(features)[0], labels).backward()
    assert torch.count_nonzero(model.policy_head.weight.grad[:, 128:]) > 0
    optimizer.step()
    assert torch.count_nonzero(model.policy_head.weight[:, 128:]) > 0
    optimizer.zero_grad()
    F.cross_entropy(model(features)[0], labels).backward()
    assert torch.count_nonzero(model.trunk[0].weight.grad[128:]) > 0


def test_checkpoint_roundtrip_infers_width_in_training_runtime_and_worker(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    monkeypatch.setattr(runtime, "_MODELS", OrderedDict())
    model = ActorCritic(obs_size=272, hidden_size=256)
    model.observation_schema = "pf-ch-context-v1"
    path = save_checkpoint("wide", model, {})
    payload = torch.load(path, map_location="cpu", weights_only=False)
    assert payload["meta"]["hidden_size"] == 256
    assert payload["meta"]["num_hidden_layers"] == 3
    trained, deployed = load_model(path), runtime.load_actor_critic(path)
    assert trained.trunk[0].out_features == deployed.trunk[0].out_features == 256
    features = torch.randn(4, 272)
    with torch.no_grad():
        assert torch.equal(trained(features)[0], deployed(features)[0])
    captured = {}

    def no_native_episode(worker, case, *_args):
        captured.update(width=worker.trunk[0].out_features, schema=worker.observation_schema)
        assert all(torch.equal(v, worker.state_dict()[k]) for k, v in model.state_dict().items())
        return "worker-roundtrip"

    monkeypatch.setattr(train_ppo, "run_pf_ch_episode", no_native_episode)
    assert (
        train_ppo._collect_pf_ch((model.state_dict(), "case", 7, 0.99, 0.95, "pf-ch-context-v1", 0.0))
        == "worker-roundtrip"
    )
    assert captured == {"width": 256, "schema": "pf-ch-context-v1"}


def test_ppo_uses_loaded_wide_model_for_serial_rollout(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    source = _write(tmp_path / "wide.pt", ActorCritic(hidden_size=256))
    widths = []

    def fake_episode(actor, _scenario, _rng, _gamma, _lam, batch, stats):
        widths.append(actor.trunk[0].out_features)
        features = torch.zeros(1, 36)
        with torch.no_grad():
            logits, values = actor(features)
        batch.obs.append(features[0].numpy())
        batch.mask.append(np.ones(5, dtype=np.float32))
        batch.action.append(2)
        batch.logp.extend(logits.log_softmax(-1)[:, 2].tolist())
        batch.value.extend(values.tolist())
        batch.advantage.append(0.0)
        batch.ret.extend(values.tolist())
        stats.steps += 1
        stats.trains += 1
        stats.arrived += 1
        stats.returns.append(0.0)

    monkeypatch.setattr(train_ppo, "run_episode", fake_episode)
    result = train_ppo.train(
        [
            "--name",
            "wide-ppo",
            "--from",
            str(source),
            "--iterations",
            "1",
            "--samples-per-iter",
            "1",
            "--epochs",
            "1",
            "--device",
            "cpu",
            "--entropy-coef",
            "0",
            "--value-coef",
            "0",
        ]
    )
    assert widths == [256]
    payload = torch.load(result["checkpoint"], map_location="cpu", weights_only=False)
    assert payload["meta"]["hidden_size"] == 256
    assert load_model(result["checkpoint"]).trunk[0].out_features == 256


def test_older_checkpoint_without_architecture_metadata_keeps_default(tmp_path):
    path = _write(tmp_path / "legacy.pt", ActorCritic(), metadata=False)
    assert load_model(path).trunk[0].out_features == 128
    assert runtime.load_actor_critic(path).trunk[0].out_features == 128


@pytest.mark.parametrize("change", ["width", "depth", "shape", "declared-width", "declared-depth"])
def test_malformed_architectures_fail_before_loading(tmp_path, change):
    model = ActorCritic(hidden_size=64 if change == "width" else 128, num_hidden_layers=4 if change == "depth" else 3)
    payload = {"model": copy.deepcopy(model.state_dict()), "meta": {}}
    if change == "shape":
        payload["model"]["trunk.2.weight"] = torch.zeros(128, 127)
    if change == "declared-width":
        payload["meta"]["hidden_size"] = 256
    if change == "declared-depth":
        payload["meta"]["num_hidden_layers"] = 4
    path = tmp_path / "invalid.pt"
    torch.save(payload, path)
    with pytest.raises(ValueError):
        load_model(path)
    with pytest.raises(ValueError):
        runtime.load_actor_critic(path)


def test_shrinking_and_unsupported_target_widths_are_rejected(tmp_path):
    path = _write(tmp_path / "wide.pt", ActorCritic(hidden_size=256))
    for width in (128, 64, 512):
        with pytest.raises(ValueError):
            load_model(path, hidden_size=width)
