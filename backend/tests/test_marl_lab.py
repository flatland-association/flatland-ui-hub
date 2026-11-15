"""MARL lab, step 3 (docs/plans/marl-lab-plan.md): lab checkpoints in the
registry, and short runs of the PPO trainer and the intervention fine-tune."""
import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.core.env_factory import create_env
from app.policies import registry
from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT, LearnedPpoPolicy

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def lab_dir(tmp_path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(root))
    return root


def _copy_ecml(root: Path, name: str) -> Path:
    path = root / f"{name}.pt"
    path.write_bytes(DEFAULT_CHECKPOINT.read_bytes())
    return path


# ── registry ────────────────────────────────────────────────────────────

def test_every_lab_checkpoint_is_its_own_policy(lab_dir):
    _copy_ecml(lab_dir, "alpha")
    _copy_ecml(lab_dir, "beta")
    (lab_dir / "not a name!.pt").write_bytes(b"")  # unusable as an id: ignored
    ids = registry.policy_ids(include_hidden=False)
    assert "lab:alpha" in ids and "lab:beta" in ids
    assert not any("not a name" in pid for pid in ids)

    spec = registry.get_policy_spec("lab:alpha")
    assert spec.family == "learned"
    assert spec.show_in_ui and not spec.is_default  # torch is installed for tests
    assert spec.supports_scenarios is False
    assert "lab:alpha" not in registry.scenario_policy_factories()


def test_lab_policy_runs_and_logs_like_learned_ppo(lab_dir):
    _copy_ecml(lab_dir, "alpha")
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    policy = registry.create_runtime_policy("lab:alpha", env)
    assert isinstance(policy, LearnedPpoPolicy)
    handles = env.get_agent_handles()
    assert set(policy.act_many(handles, {})) == set(handles)
    assert policy.intervention_features(handles[0])["policy"] == "LearnedPpoPolicy(alpha)"

    branch = registry.get_policy_spec("lab:alpha").branch_factory()
    branch.reset(env)
    assert set(branch.act_many(handles, {})) == set(handles)


def test_lab_policy_appears_and_disappears_without_restart(lab_dir):
    assert registry.get_policy_spec("lab:later") is None
    path = _copy_ecml(lab_dir, "later")
    assert registry.get_policy_spec("lab:later") is not None
    path.unlink()
    assert registry.get_policy_spec("lab:later") is None
    assert "lab:later" not in registry.policy_ids()


def test_description_comes_from_the_sidecar(lab_dir):
    path = _copy_ecml(lab_dir, "tuned")
    path.with_suffix(".json").write_text(json.dumps(
        {"kind": "hg-dagger", "interventions": 12, "base": "x/ecml2026_ppo.pt"}))
    spec = registry.get_policy_spec("lab:tuned")
    assert "12 human interventions" in spec.description
    assert "ecml2026_ppo" in spec.description


def test_lab_policies_hidden_without_torch(lab_dir, monkeypatch):
    _copy_ecml(lab_dir, "alpha")
    monkeypatch.setattr(registry, "_TORCH_AVAILABLE", False)
    assert registry.get_policy_spec("lab:alpha").show_in_ui is False
    assert "lab:alpha" not in registry.policy_ids(include_hidden=False)


def test_listing_lab_policies_does_not_import_torch(lab_dir):
    # The app must start without torch: the registry only lists files.
    _copy_ecml(lab_dir, "alpha")
    code = (
        "import sys; from app.policies import registry; "
        "ids = registry.policy_ids(); assert 'lab:alpha' in ids, ids; "
        "registry.get_policy_spec('lab:alpha'); print('torch' in sys.modules)"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True,
                         env={**__import__("os").environ}, check=True)
    assert out.stdout.strip().splitlines()[-1] == "False"


# ── training ────────────────────────────────────────────────────────────

def test_short_ppo_run_writes_checkpoint_and_curve(lab_dir):
    from lab.marl.train_ppo import train

    result = train([
        "--name", "tiny", "--scenario", "gen:25x25:2:*", "--iterations", "2",
        "--samples-per-iter", "128", "--epochs", "1", "--minibatch", "64", "--device", "cpu",
    ])
    assert result["checkpoint"] == lab_dir / "tiny.pt"
    rows = list(csv.DictReader(result["csv"].open()))
    assert [r["iteration"] for r in rows] == ["1", "2"]
    for key in ("arrival_rate", "mean_return", "policy_loss", "value_loss", "entropy"):
        assert rows[-1][key] != ""
    meta = json.loads((lab_dir / "tiny.json").read_text())
    assert meta["kind"] == "ppo" and meta["iterations"] == 2

    # The hub loads it as a normal lab policy.
    env = create_env(width=30, height=30, number_of_agents=3, seed=1)
    policy = registry.create_runtime_policy("lab:tiny", env)
    assert set(policy.act_many(env.get_agent_handles(), {})) == set(env.get_agent_handles())


def test_continue_from_a_checkpoint(lab_dir):
    from lab.marl.train_ppo import train

    result = train([
        "--name", "cont", "--from", str(DEFAULT_CHECKPOINT), "--scenario", "gen:25x25:2:7",
        "--iterations", "1", "--samples-per-iter", "64", "--epochs", "1", "--device", "cpu",
    ])
    assert result["checkpoint"].is_file()
    assert json.loads((lab_dir / "cont.json").read_text())["base"] == str(DEFAULT_CHECKPOINT)


def _write_interventions(runs: Path) -> int:
    """Interventions as app/core/intervention_log.py writes them: the human
    always picks STOP where the policy wanted something else."""
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    policy = LearnedPpoPolicy(env)
    handles = env.get_agent_handles()
    lines = []
    for step in range(30):
        actions = policy.act_many(handles, {})
        for h in handles:
            seen = policy.intervention_features(h)
            if seen["mask"][4] > 0.5 and actions[h] != 4:
                lines.append({"owner": "human", "mode": "director", "step": step, "handle": h,
                              "ai_action": actions[h], "human_action": 4, "agreed": False, **seen})
        env.step(actions)
    lines.append({**lines[0], "owner": "system"})  # a system hold: never learned from
    (runs / "s1").mkdir(parents=True)
    (runs / "s1" / "interventions.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    return len(lines) - 1


def test_finetune_learns_the_human_choice_and_keeps_the_rest(lab_dir, tmp_path):
    from lab.marl.finetune_interventions import finetune, load_interventions

    runs = tmp_path / "runs"
    n = _write_interventions(runs)
    assert n > 0
    kept, skipped = load_interventions(runs)
    assert len(kept) == n and skipped["not_human"] == 1

    common = ["--runs", str(runs), "--scenario", "gen:25x25:2:3", "--rollout-states", "300",
              "--epochs", "60", "--lr", "1e-3", "--device", "cpu"]
    result = finetune(["--name", "ft", "--kl-weight", "5", *common])
    assert result["before"]["all"] == 0.0  # the AI disagreed every time
    assert result["after"]["all"] > result["before"]["all"]
    meta = json.loads((lab_dir / "ft.json").read_text())
    assert meta["kind"] == "hg-dagger" and meta["interventions"] == n
    assert registry.get_policy_spec("lab:ft") is not None

    # The KL term is what keeps the rest: without it, more of the base
    # policy's own decisions change.
    no_kl = finetune(["--name", "ft-no-kl", "--kl-weight", "0", *common])
    assert result["changed"] < no_kl["changed"]


# ── PPO + DLA hybrid (measured, not registered) ─────────────────────────

def test_hybrid_hands_forward_to_dla_and_keeps_the_ppo_features():
    from app.policies.learned.hybrid_ppo_policy import HybridPpoDlaPolicy, _as_int

    env = create_env(scenario_preset_id="pf-ch-wn-wal-conflict")
    policy = HybridPpoDlaPolicy(env, gate_decisions=True)
    handles = env.get_agent_handles()
    seen_dla = False
    for _ in range(40):
        policy.start_step()
        actions = policy.act_many(handles, {})
        dla = policy.dla.act_many(handles, None)
        for h in handles:
            if policy.last_sources[h] == "dla":
                seen_dla = True
                assert actions[h] == _as_int(dla[h])
            features = policy.intervention_features(h)
            assert len(features["ai_probs"]) == 5  # still the PPO's own distribution
            assert features["ppo_action"] == policy.last_ppo_actions[h]
        env.step(actions)
    assert seen_dla


def test_hybrid_is_not_registered():
    # docs/plans/marl-lab-plan.md: measured, DLA alone beats every variant.
    assert not any("hybrid" in pid for pid in registry.policy_ids())


def test_evaluate_builds_hybrid_rows():
    from lab.marl.evaluate import make_policy

    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    policy = make_policy("hybrid:gate+dep", env, {})
    assert policy.gate_decisions and policy.veto_departures and policy.veto_do_nothing
    with pytest.raises(SystemExit):
        make_policy("hybrid:nonsense", env, {})
