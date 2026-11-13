"""Frozen UC2 actor with existing ROAM masking and joint withdrawal.

Historical final50 is an inspected regression benchmark, not a new holdout.
No training, changed feature values, motion forcing or planner rescue is used.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
from flatland.envs.step_utils.states import TrainState

from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
from app.policies.learned.uc2_bundle import CHECKPOINT, CHECKPOINT_SHA256, OBSERVATION_SCHEMA
from lab.marl.evaluate_pf_ch import summarize
from lab.marl.pf_ch_episode import PFChEpisode, load_cases
from lab.marl.roam_check import RoamCheck, open_waypoint_groups, stuck_trains, predict_configuration
from lab.marl.roam_joint_check import JointRoamCheck

VARIANTS = ('v0', 'v1', 'v2', 'v3')
VARIANT_DESCRIPTIONS = {
    'v0': 'Frozen actor and native action mask',
    'v1': 'Frozen actor and serial ROAM certificate',
    'v2': 'V1 with partial moves, max_candidates=60',
    'v3': 'Frozen actor, partial60 conditional proposals and native whole-batch ROAM certificate',
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def elapsed_ms(start):
    return 1000 * (time.perf_counter() - start)


def run_case(case, variant, checkpoint, trace_dir=None, reference_audit=True, motion_logit_bias=0.0):
    started = time.perf_counter()
    episode = PFChEpisode(case, observation_schema=OBSERVATION_SCHEMA)
    trace = None
    try:
        policy = LearnedPpoPolicy(episode.env, checkpoint=checkpoint)
        check_class = JointRoamCheck if variant == 'v3' else RoamCheck
        check = check_class(episode.env, partial_moves=variant in ('v2', 'v3'), max_candidates=60)
        if trace_dir:
            trace_dir.mkdir(parents=True, exist_ok=True)
            trace = (trace_dir / f'{variant}-{case.case_id}.jsonl').open('x')
        counts = dict(mask_changed_decisions=0, mask_removed_actions=0, mask_action_changes=0,
                      withdrawals=0, moving_to_stopped=0, uncertified_steps=0,
                      new_stuck_steps=0, reference_disagreements=0, prediction_mismatches=0,
                      prediction_mismatches_with_new_fault=0, resource_conflicts=0,
                      policy_wait_with_allowed_motion=0)
        timings = {name: [] for name in ('prepare_ms', 'policy_ms', 'mask_ms', 'withdrawal_ms',
                                         'counterfactual_policy_ms', 'audit_ms', 'decision_ms')}
        last_change = {h: 0 for h in episode.handles}
        prep = time.perf_counter() - started
        actual_stuck = set()
        while not episode.done:
            now = episode.now
            before = {a.handle: (a.state, a.current_configuration,
                      bool(a.malfunction_handler.in_malfunction)) for a in episode.env.agents}
            t0 = time.perf_counter()
            handles, obs, width = policy.prepare_inference(episode.handles)
            assert width == 313 and obs.shape[1] == 318
            timings['prepare_ms'].append(elapsed_ms(t0))
            t0 = time.perf_counter()
            groups = open_waypoint_groups(policy.obs_builder.base)
            _, baseline = check.snapshot(groups)
            snapshot_ms = elapsed_ms(t0)
            t0 = time.perf_counter()
            original = policy.infer_prepared((handles, obs, width))
            original_probs = dict(policy.last_action_probs)
            original_ms = elapsed_ms(t0)
            selected_obs = obs
            if variant == 'v0':
                masked = dict(original)
                actions = dict(original)
                expected = None
                timings['policy_ms'].append(original_ms)
                timings['counterfactual_policy_ms'].append(0.0)
                timings['mask_ms'].append(0.0)
                timings['withdrawal_ms'].append(0.0)
            else:
                timings['counterfactual_policy_ms'].append(original_ms)
                t0 = time.perf_counter()
                safety = check.action_mask(groups)
                selected_obs = obs.copy()
                for i, h in enumerate(handles):
                    combined = np.minimum(obs[i, width:], safety[h])
                    assert np.any(combined >= .5), 'No legal fallback after mask intersection'
                    counts['mask_changed_decisions'] += int(not np.array_equal(obs[i, width:], combined))
                    counts['mask_removed_actions'] += int(np.sum((obs[i, width:] >= .5) & (combined < .5)))
                    selected_obs[i, width:] = combined
                assert np.array_equal(obs[:, :width], selected_obs[:, :width])
                timings['mask_ms'].append(snapshot_ms + elapsed_ms(t0))
                t0 = time.perf_counter()
                masked = policy.infer_prepared((handles, selected_obs, width))
                if motion_logit_bias:
                    for i, h in enumerate(handles):
                        agent = episode.env.agents[h]
                        scores = np.log(np.maximum(policy.last_action_probs[h], 1e-30))
                        for action in range(5):
                            cfg = predict_configuration(episode.env, agent, action)
                            if cfg is not None and cfg != agent.current_configuration:
                                scores[action] += motion_logit_bias
                        scores[selected_obs[i, width:] < .5] = -np.inf
                        masked[h] = int(np.argmax(scores))
                timings['policy_ms'].append(elapsed_ms(t0))
                counts['mask_action_changes'] += sum(masked[h] != original[h] for h in handles)
                t0 = time.perf_counter()
                actions = check.withdraw(masked, groups)
                timings['withdrawal_ms'].append(elapsed_ms(t0))
                counts['withdrawals'] += len(check.withdrawn_handles)
                expected = dict(check.last_predictions)
            counts['policy_wait_with_allowed_motion'] += sum(actions[h] == 4 and any(
                selected_obs[i, width + a] >= .5 for a in (1, 2, 3)) for i, h in enumerate(handles))
            timings['decision_ms'].append(sum(timings[n][-1] for n in ('prepare_ms', 'policy_ms', 'mask_ms', 'withdrawal_ms')))
            episode.step(actions)
            t0 = time.perf_counter()
            after_groups = open_waypoint_groups(policy.obs_builder.base)
            trains, actual_stuck = check.snapshot(after_groups)
            if reference_audit:
                reference = stuck_trains(check.tables, trains, partial_moves=check.partial_moves, max_candidates=60)
                counts['reference_disagreements'] += int(reference != actual_stuck)
            counts['uncertified_steps'] += int(bool(actual_stuck))
            counts['new_stuck_steps'] += int(bool(actual_stuck - baseline))
            held = [episode.env.resource_map.get_resource(a.current_configuration)
                    for a in episode.env.agents if a.state.is_on_map_state()]
            counts['resource_conflicts'] += int(len(held) != len(set(held)))
            surprise = any(not before[a.handle][2] and bool(getattr(getattr(
                episode.env.temp_transition_data.get(a.handle), 'state_transition_signal', None),
                'in_malfunction', False)) for a in episode.env.agents)
            for a in episode.env.agents:
                if a.current_configuration != before[a.handle][1]:
                    last_change[a.handle] = episode.now
                counts['moving_to_stopped'] += int(before[a.handle][0] == TrainState.MOVING and a.state == TrainState.STOPPED)
                if expected is not None and expected[a.handle] != a.current_configuration:
                    key = 'prediction_mismatches_with_new_fault' if surprise else 'prediction_mismatches'
                    counts[key] += 1
            timings['audit_ms'].append(elapsed_ms(t0) + (snapshot_ms if variant == 'v0' else 0.0))
            if trace:
                trace.write(json.dumps({'step_before': now, 'step_after': episode.now,
                    'original_actions': original, 'masked_actions': masked, 'executed_actions': actions,
                    'original_probs': original_probs, 'mask': selected_obs[:, width:].tolist(),
                    'stuck_before': sorted(baseline), 'stuck_after': sorted(actual_stuck),
                    'surprise_fault': surprise, 'trains': [{'handle': a.handle, 'state': a.state.name,
                        'configuration': a.current_configuration, 'speed': str(a.speed_counter.speed),
                        'distance': str(a.speed_counter.distance),
                        'malfunction': int(a.malfunction_handler.malfunction_down_counter)} for a in episode.env.agents]}) + '\n')
        stationary = {h: episode.now - last_change[h] for h in episode.handles if episode.env.agents[h].state.is_on_map_state()}
        return {**episode.metrics(), 'policy': variant, 'motion_logit_bias': motion_logit_bias,
                **counts, 'preparation_seconds': prep,
                'seconds': time.perf_counter() - started, 'endpoint_stuck': sorted(actual_stuck),
                'stationary_tail_steps': stationary, 'stationary_on_map_at_least20': [h for h, age in stationary.items() if age >= 20],
                'roam_cache': check.reachability_cache_info(), 'planner_interventions': 0,
                'latency': {name: {'mean': float(np.mean(v)) if v else 0.0,
                    'p50': float(np.percentile(v, 50)) if v else 0.0,
                    'p95': float(np.percentile(v, 95)) if v else 0.0} for name, v in timings.items()}}
    except Exception as exc:
        return {**episode.metrics(), 'policy': variant, 'complete_mission': False,
                'technical_error': f'{type(exc).__name__}: {exc}', 'seconds': time.perf_counter() - started}
    finally:
        if trace:
            trace.close()
        episode.close()


def evaluate(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, default=CHECKPOINT)
    parser.add_argument('--variant', action='append', choices=VARIANTS)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--trace-dir', type=Path)
    parser.add_argument('--case-id', action='append')
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--no-reference-audit', action='store_true')
    parser.add_argument('--motion-logit-bias', type=float, default=0.0,
                        help='Experimental score bias for physically advancing safe proposals; not training')
    args = parser.parse_args(argv)
    if not np.isfinite(args.motion_logit_bias) or args.motion_logit_bias < 0:
        parser.error('--motion-logit-bias must be finite and nonnegative')
    if args.motion_logit_bias and args.variant != ['v3']:
        parser.error('Experimental motion bias requires exactly --variant v3')
    if args.output.exists():
        raise FileExistsError(args.output)
    assert digest(args.checkpoint) == CHECKPOINT_SHA256, 'Frozen published checkpoint required'
    torch.set_num_threads(args.threads)
    cases = load_cases(args.cases)
    if args.case_id:
        cases = [c for c in cases if c.case_id in args.case_id]
        assert {c.case_id for c in cases} == set(args.case_id)
    variants = args.variant or list(VARIANTS)
    backend = Path(__file__).resolve().parents[2]
    files = [Path(__file__).resolve(), Path(__file__).resolve().with_name('roam_check.py'),
             Path(__file__).resolve().with_name('roam_joint_check.py'),
             backend/'app/policies/learned/roam_check.py',
             backend/'app/policies/learned/roam_joint_check.py',
             backend/'app/policies/learned/learned_ppo_policy.py', backend/'app/policies/learned/uc2_observation.py']
    sources = {str(p.relative_to(backend)): digest(p) for p in files}
    frozen = {'checkpoint_sha256': digest(args.checkpoint), 'manifest_sha256': digest(args.cases),
              'native_fixtures': {s: digest(backend/'app/fixtures/plan-b'/s/'scenario.pkl')
                                 for s in ('tutorial', 'uc2-1', 'uc2-2', 'uc2-3', 'uc2-4')}}
    rows = []
    started = time.perf_counter()
    for case in cases:
        for variant in variants:
            row = run_case(case, variant, args.checkpoint, args.trace_dir, not args.no_reference_audit,
                           args.motion_logit_bias)
            rows.append(row)
            print(json.dumps({k: row[k] for k in ('case_id', 'policy', 'arrived', 'total', 'complete_mission', 'lateness')}
                             | {k: row[k] for k in ('technical_error',) if k in row}), flush=True)
    assert digest(args.checkpoint) == frozen['checkpoint_sha256'] and digest(args.cases) == frozen['manifest_sha256']
    assert all(digest(backend/'app/fixtures/plan-b'/s/'scenario.pkl') == h for s, h in frozen['native_fixtures'].items())
    assert sources == {str(p.relative_to(backend)): digest(p) for p in files}
    report = {'schema': 'uc2-roam-inference-ablation-v1', 'scope': 'Fixed native scenarios; historical final50 is an inspected regression set',
              'training_or_selection': False, 'variants': variants,
              'motion_logit_bias': args.motion_logit_bias,
              'variant_descriptions': {v: VARIANT_DESCRIPTIONS[v] for v in variants},
              'inputs': frozen, 'source_sha256': sources,
              'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'versions': {n: importlib.metadata.version(n) for n in ('flatland-rl', 'torch', 'numpy')},
              'actual_post_step_reference_audit': not args.no_reference_audit,
              'latency_scope': 'CPU1; decision includes preparation+masked inference+mask+withdrawal; excludes separate counterfactual inference, audit and env.step. Wall seconds include diagnostics. Not a large-map timing claim.',
              'wall_seconds': time.perf_counter() - started, 'summary': summarize(rows), 'results': rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary']), flush=True)
    return report


if __name__ == '__main__':
    evaluate()
