"""Compare PF-CH policies on explicit cases with live incidents and mission metrics."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import torch
from flatland.envs.rail_env_action import RailEnvActions

from lab.marl.collect_pp_demonstrations import create_teacher
from lab.marl.evaluate import make_policy, policy_rows
from lab.marl.pf_ch_episode import PFChEpisode, load_cases


def _action_values(actions) -> dict[int, int]:
    """Convert native policy enums or integer scalars into episode actions."""
    converted = {}
    for handle, action in actions.items():
        if isinstance(action, RailEnvActions):
            action = action.value
        if not isinstance(action, (int, np.integer)):
            raise TypeError(f'policy returned unsupported action {action!r}')
        converted[int(handle)] = int(action)
    return converted


def evaluate_case(case, policy_id: str, checkpoints: dict[str, Path]) -> dict:
    """Run one policy to the same mission boundary, retaining every failed case."""
    episode = PFChEpisode(case)
    started = time.perf_counter()
    latency = []
    try:
        is_teacher = policy_id in ('pp', 'pp-replan', 'pp-trainruns', 'pp-trainruns-replan')
        if is_teacher:
            teacher = create_teacher(episode.env, preset=case.preset, max_orders=4,
                                     executor='trainruns' if 'trainruns' in policy_id else 'schedules',
                                     replan_on_incidents=policy_id.endswith('-replan'), max_replans=8)
            if teacher is None:
                return {**episode.metrics(), 'policy': policy_id, 'failure': 'no_valid_pp_plan',
                        'preparation_seconds': time.perf_counter() - started}
            teacher_policy, _proof, _ = teacher
            policy = teacher_policy
            choose_actions = lambda: teacher_policy.act_many(episode.handles)
        else:
            learned_policy = make_policy(policy_id, episode.env, checkpoints)
            policy = learned_policy
            choose_actions = lambda: learned_policy.act_many(episode.handles, episode.session.last_observations)
        preparation = time.perf_counter() - started
        while not episode.done:
            t0 = time.perf_counter()
            if hasattr(policy, 'start_step'):
                policy.start_step()
            actions = choose_actions()
            latency.append(1000 * (time.perf_counter() - t0))
            episode.step(_action_values(actions))
            if hasattr(policy, 'end_step'):
                policy.end_step()
        return {**episode.metrics(), 'policy': policy_id, 'preparation_seconds': preparation,
                'seconds': time.perf_counter() - started,
                'decision_ms_p50': float(np.percentile(latency, 50)) if latency else 0.0,
                'decision_ms_p95': float(np.percentile(latency, 95)) if latency else 0.0,
                'planner_interventions': 1 + getattr(policy, 'accepted_replans', 0) if is_teacher else 0,
                'policy_observation_schema': getattr(getattr(policy, 'model', None), 'observation_schema', None),
                'teacher_replan_attempts': getattr(policy, 'replan_attempts', []),
                'teacher_accepted_replans': getattr(policy, 'accepted_replans', 0),
                'teacher_hold_steps': getattr(policy, 'hold_steps', 0),
                'teacher_off_plan_handles': sorted(getattr(getattr(policy, 'player', policy), 'off_plan_handles', []))}
    except (RuntimeError, ValueError, AssertionError, TypeError) as error:
        return {**episode.metrics(), 'policy': policy_id, 'complete_mission': False,
                'technical_error': f'{type(error).__name__}: {error}',
                'seconds': time.perf_counter() - started}
    finally:
        episode.close()


def summarize(records: list[dict]) -> dict:
    """Aggregate complete missions separately from arrivals and calls."""
    totals = {}
    for policy in sorted({row['policy'] for row in records}):
        rows = [row for row in records if row['policy'] == policy]
        totals[policy] = {
            'technical_failures': sum('technical_error' in row for row in rows),
            'scheduled_incidents': sum(row.get('scheduled_incidents', 0) for row in rows),
            'exposed_train_delay_incidents': sum(row.get('exposed_train_delay_incidents', 0) for row in rows),
            'train_delay_exposure_steps': sum(row.get('train_delay_exposure_steps', 0) for row in rows),
            'cases': len(rows), 'complete_missions': sum(row['complete_mission'] for row in rows),
            'arrived': sum(row['arrived'] for row in rows), 'trains': sum(row['total'] for row in rows),
            'served_calls': sum(row['served_calls'] for row in rows),
            'required_calls': sum(row['required_calls'] for row in rows),
            'lateness': sum(row['lateness'] for row in rows),
            'by_preset': {preset: {'cases': sum(row['case']['preset'] == preset for row in rows),
                'complete_missions': sum(row['complete_mission'] for row in rows if row['case']['preset'] == preset)}
                for preset in sorted({row['case']['preset'] for row in rows})},
            'failed_cases': [row['case_id'] for row in rows if not row['complete_mission']],
        }
    return totals


def evaluate(argv: list[str] | None = None) -> dict:
    """Write per-case evidence and checkpoint hashes; never select from test cases."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, action='append', default=[])
    parser.add_argument('--policy', action='append', default=[])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=1)
    args = parser.parse_args(argv)
    if args.output.exists():
        raise FileExistsError(f'refusing to overwrite {args.output}')
    torch.set_num_threads(args.threads)
    cases = load_cases(args.cases)
    rows, checkpoints = policy_rows(args.policy, args.checkpoint)
    if not rows:
        raise ValueError('at least one --policy or --checkpoint required')
    initial_hashes = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in checkpoints.items()}
    records = []
    for case in cases:
        for policy in rows:
            result = evaluate_case(case, policy, checkpoints)
            records.append(result)
            print(json.dumps({key: result[key] for key in ('case_id', 'policy', 'arrived', 'total',
                             'served_calls', 'required_calls', 'complete_mission')}), flush=True)
    if any(hashlib.sha256(path.read_bytes()).hexdigest() != initial_hashes[key] for key, path in checkpoints.items()):
        raise RuntimeError('checkpoint changed during evaluation; rerun with frozen files')
    report = {'schema': 'pf-ch-evaluation-v1', 'manifest': str(args.cases),
              'manifest_sha256': hashlib.sha256(args.cases.read_bytes()).hexdigest(),
              'checkpoints': {key: {'path': str(path), 'sha256': initial_hashes[key]}
                              for key, path in checkpoints.items()},
              'summary': summarize(records), 'results': records}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary']), flush=True)
    return report


if __name__ == '__main__':
    evaluate()
