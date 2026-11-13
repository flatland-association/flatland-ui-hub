"""Audit the actual registered UC2 driver; cases never select a model by outcome."""
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

from app.policies.learned import uc2_roam_bundle
from app.policies.learned.roam_check import open_waypoint_groups, stuck_trains
from app.policies.registry import create_runtime_policy
from lab.marl.evaluate_pf_ch import summarize
from lab.marl.pf_ch_episode import PFChEpisode, load_cases


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_hashes():
    backend = Path(__file__).resolve().parents[2]
    paths = ['lab/marl/evaluate_uc2_roam_runtime.py', 'lab/marl/pf_ch_episode.py',
             'app/policies/registry.py', 'app/policies/learned/uc2_roam_policy.py',
             'app/policies/learned/uc2_roam_bundle.py', 'app/policies/learned/uc2_bundle.py',
             'app/policies/learned/roam_check.py', 'app/policies/learned/roam_joint_check.py',
             'app/policies/learned/learned_ppo_policy.py', 'app/policies/learned/uc2_observation.py',
             'app/policies/learned/pf_ch_observation.py', 'app/policies/learned/ecml_observation.py',
             'app/core/env_step.py', 'app/core/stops.py', 'app/utils/agent_compat.py',
             'app/api/websockets.py', 'app/core/pf_ch_control.py']
    return {p: digest(backend / p) for p in paths}


def run_case(case, *, reference_audit=True, trace_dir=None):
    started = time.perf_counter()
    episode = PFChEpisode(case)
    trace = None
    try:
        policy = create_runtime_policy('uc2_rl', episode.env)
        check = policy.roam_check
        model_sha = digest(policy.checkpoint)
        preparation = time.perf_counter() - started
        counts = dict(reference_disagreements=0, new_stuck_steps=0, uncertified_steps=0,
                      prediction_mismatches=0, prediction_mismatches_with_new_fault=0,
                      resource_conflicts=0, withdrawals=0)
        latencies = []
        if trace_dir:
            trace_dir.mkdir(parents=True, exist_ok=True)
            trace = (trace_dir / f'{case.case_id}.jsonl').open('x')
        while not episode.done:
            before = {a.handle: bool(a.malfunction_handler.in_malfunction) for a in episode.env.agents}
            t0 = time.perf_counter()
            actions = policy.act_many(episode.handles)
            latencies.append(1000 * (time.perf_counter() - t0))
            baseline, expected = set(check.stuck_before), dict(check.last_predictions)
            counts['withdrawals'] += len(check.withdrawn_handles)
            episode.step(actions)
            groups = open_waypoint_groups(policy.obs_builder.base)
            trains, actual = check.snapshot(groups)
            if reference_audit:
                reference = stuck_trains(check.tables, trains, partial_moves=True, max_candidates=60)
                counts['reference_disagreements'] += int(actual != reference)
            counts['uncertified_steps'] += int(bool(actual))
            counts['new_stuck_steps'] += int(bool(actual - baseline))
            held = [episode.env.resource_map.get_resource(a.current_configuration)
                    for a in episode.env.agents if a.state.is_on_map_state()]
            counts['resource_conflicts'] += int(len(held) != len(set(held)))
            surprises = {a.handle for a in episode.env.agents if not before[a.handle] and bool(getattr(
                getattr(episode.env.temp_transition_data.get(a.handle), 'state_transition_signal', None),
                'in_malfunction', False))}
            for agent in episode.env.agents:
                if expected[agent.handle] != agent.current_configuration:
                    # A new fault can also cancel a following train's move.
                    key = 'prediction_mismatches_with_new_fault' if surprises else 'prediction_mismatches'
                    counts[key] += 1
            if trace:
                trace.write(json.dumps({'step': episode.now, 'actions': actions,
                    'actual_stuck': sorted(actual), 'new_fault_handles': sorted(surprises),
                    'trains': [{'handle': a.handle, 'state': a.state.name,
                                'configuration': a.current_configuration,
                                'arrival_time': getattr(a, 'arrival_time', None)}
                               for a in episode.env.agents]}) + '\n')
        return {**episode.metrics(), 'policy': 'uc2_rl', 'checkpoint_sha256': model_sha,
                'selected_infrastructure': policy.obs_builder.scenario_id,
                'checkpoint_file': policy.checkpoint.name, 'planner_interventions': 0,
                'motion_logit_bias': 0, **counts,
                'endpoint_stuck': sorted(actual), 'roam_cache': check.reachability_cache_info(),
                'preparation_seconds': preparation, 'seconds': time.perf_counter() - started,
                'decision_ms_mean': float(np.mean(latencies)),
                'decision_ms_p95': float(np.percentile(latencies, 95))}
    except Exception as exc:
        return {**episode.metrics(), 'policy': 'uc2_rl', 'complete_mission': False,
                'technical_error': f'{type(exc).__name__}: {exc}',
                'seconds': time.perf_counter() - started}
    finally:
        if trace:
            trace.close()
        episode.close()


def evaluate(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--trace-dir', type=Path)
    parser.add_argument('--no-reference-audit', action='store_true')
    args = parser.parse_args(argv)
    if args.output.exists():
        raise FileExistsError(args.output)
    torch.set_num_threads(1)
    manifest = uc2_roam_bundle.verify_bundle()
    sources = source_hashes()
    backend = Path(__file__).resolve().parents[2]
    frozen = {'case_manifest_sha256': digest(args.cases),
              'bundle_manifest_sha256': digest(uc2_roam_bundle.MANIFEST),
              'model_sha256': {k: v['sha256'] for k, v in manifest['models'].items()},
              'native_fixtures': {k: digest(backend/'app/fixtures/plan-b'/k/'scenario.pkl')
                                  for k in uc2_roam_bundle.SCENARIOS}}
    rows, started = [], time.perf_counter()
    for case in load_cases(args.cases):
        row = run_case(case, reference_audit=not args.no_reference_audit, trace_dir=args.trace_dir)
        rows.append(row)
        print(json.dumps({k: row.get(k) for k in ('case_id', 'complete_mission', 'lateness', 'technical_error')}), flush=True)
    assert frozen['case_manifest_sha256'] == digest(args.cases)
    assert frozen['bundle_manifest_sha256'] == digest(uc2_roam_bundle.MANIFEST)
    assert all(digest(backend/'app/fixtures/plan-b'/k/'scenario.pkl') == sha
               for k, sha in frozen['native_fixtures'].items())
    assert sources == source_hashes() and uc2_roam_bundle.verify_bundle() == manifest
    report = {'schema': 'uc2-roam-registered-runtime-evaluation-v1',
              'scope': 'Fixed native maps; development/confirmation status is supplied by the external freeze protocol',
              'selection': 'Immutable infrastructure identity only; no PP/DLA runtime fallback',
              'inputs': frozen, 'source_sha256': sources,
              'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'source_worktree_dirty': bool(subprocess.check_output(
                  ['git', 'status', '--porcelain', '--', 'app', 'lab/marl'], text=True).strip()),
              'versions': {name: importlib.metadata.version(name) for name in ('flatland-rl', 'torch', 'numpy')},
              'actual_post_step_reference_audit': not args.no_reference_audit,
              'prediction_audit_scope': 'Known current faults only. Post-step new-fault flags classify co-occurring prediction differences; not a per-difference causal proof.',
              'latency_scope': 'CPU1 instrumented decision cost includes capture, inference, mask and withdrawal; excludes actual env.step and independent post-step audits. Audits warm caches; not a production cold-start or large-map claim.',
              'wall_seconds': time.perf_counter() - started,
              'summary': summarize(rows), 'results': rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary']), flush=True)
    return report


if __name__ == '__main__':
    evaluate()
