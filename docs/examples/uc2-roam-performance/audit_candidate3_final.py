"""Read-only independent C3 confirmation/domain audit; never run a policy.

Confirmation reads the reserved40 only after the owner has opened both complete
reports. Domain publishes every paired row of the declared1472 finite grid,
including training inputs; that grid is explicitly not a blind test.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
import subprocess

from audit_candidate2_development import canonical_case, key, normalized_pp, pair, sums

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PRESETS = ('tutorial', 'uc2-1', 'uc2-2', 'uc2-3', 'uc2-4')
FRESH = '193d9d63a235261a70fd0cb0a9b1e2fab6a5967239c267fd6cfec19f364ac1b1'
PROTOCOL = '3aa8d0f77af4cf62cac675a4fd504cc9fd630c7e489dfe971fe582804edc6222'
DOMAIN = 'e87c63a4e267154ba1fed09085cd6fabb8f822e874fb3c8bc5e23c236579e13a'
LOCK = 'fa6f4d38ee940f66828550312a83d579320a3acf7e115c5f1396afe1d8cb734c'
HORIZONS = {'tutorial': 40, 'uc2-1': 168, 'uc2-2': 102, 'uc2-3': 240, 'uc2-4': 180}
COUNTERS = ('reference_disagreements', 'new_stuck_steps', 'uncertified_steps',
            'resource_conflicts', 'prediction_mismatches', 'prediction_mismatches_with_new_fault',
            'withdrawals', 'planner_interventions')
ADVERSE = ('reference_disagreements', 'new_stuck_steps', 'uncertified_steps',
           'resource_conflicts', 'prediction_mismatches', 'planner_interventions')


def read(p):
    return json.loads(Path(p).read_text())


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def git_bytes(commit, path):
    return subprocess.check_output(['git', 'show', f'{commit}:{path}'], cwd=ROOT)


def publish(p, d):
    assert not p.exists(), 'Never overwrite completed evidence'
    text = json.dumps(d, indent=2) + '\n'
    assert all(s not in text for s in ('/private/tmp/', '/Users/', '/var/folders/'))
    temp = p.with_suffix(p.suffix + '.tmp')
    temp.write_text(text)
    temp.replace(p)


def freeze_audit():
    pp = HERE / 'confirmation40-v3-protocol.json'
    assert sha(pp) == PROTOCOL
    protocol = read(pp)
    assert sha(HERE / protocol['manifest']) == protocol['manifest_sha256'] == FRESH
    assert sha(HERE / protocol['generator']) == protocol['generator_sha256']
    old = set()
    for relative, digest in protocol['excluded_manifest_sha256'].items():
        assert sha(ROOT / relative) == digest
        old.update(key(c) for c in read(ROOT / relative)['cases'])
    reserved = {key(c) for c in read(HERE / protocol['manifest'])['cases']}
    assert len(old) == 925 and len(reserved) == 40 and not reserved & old
    provenance = read(HERE / 'dense-v3-training-input-provenance.json')
    assert provenance['reserved_manifest_sha256'] == FRESH
    dense = []
    for entry in provenance['manifests']:
        p = HERE / entry['copied_manifest']
        assert sha(p) == entry['source_sha256'] == entry['copied_sha256']
        data = read(p)
        preset = entry['preset']
        arity, maximum = (2, 10) if preset == 'tutorial' else (3, 7)
        expected = {(preset, v) for v in itertools.product(range(maximum), repeat=arity)} - reserved
        actual = {key(c) for c in data['cases']}
        assert len(data['cases']) == len(actual) == entry['cases'] and actual == expected
        assert not actual & reserved
        dense.append({'preset': preset, 'cases': entry['cases'], 'manifest_sha256': sha(p), 'reserved_overlap': 0})
    # Original adverse confirmations are immutable historical evidence.
    old84 = read(HERE / 'confirmation84-independent-audit.json')
    old100 = read(HERE / 'confirmation100-v2-independent-audit.json')
    assert old84['summary']['lateness_worse'] == 4 and not old84['primary_casewise_pp_gate_passed']
    assert old100['summary']['lateness_worse'] == 16 and not old100['primary_casewise_pp_gate_passed']
    for name, digest in old84['input_file_sha256'].items():
        assert sha(HERE / name) == digest
    names = {'lock': 'candidate-lock-v2.json', 'runtime': 'confirmation100-v2-runtime.json',
             'pp': 'confirmation100-v2-pp.json', 'known209': 'known209-runtime-candidate2.json'}
    for label, digest in old100['file_sha256'].items():
        assert sha(HERE / names[label]) == digest
    return protocol, reserved, dense


def verify_runtime(runtime, manifest_path, lock, protocol):
    assert runtime['source_commit'] == lock['source_commit'] and runtime['source_worktree_dirty'] is False
    assert runtime['source_sha256'] == lock['source_sha256']
    for relative, digest in lock['source_sha256'].items():
        assert hashlib.sha256(git_bytes(lock['source_commit'], 'backend/' + relative)).hexdigest() == digest
    assert runtime['actual_post_step_reference_audit'] is True
    assert runtime['inputs']['case_manifest_sha256'] == sha(manifest_path)
    assert runtime['inputs']['bundle_manifest_sha256'] == lock['bundle_manifest_sha256']
    bundle_bytes = git_bytes(lock['source_commit'], 'backend/app/policies/learned/checkpoints/uc2_roam_specialists.json')
    assert hashlib.sha256(bundle_bytes).hexdigest() == lock['bundle_manifest_sha256']
    bundle = json.loads(bundle_bytes)
    assert bundle['models'] == lock['models']
    assert bundle['selector'] == 'immutable_native_fixture_identity_only'
    assert bundle['guard'] == lock['guard'] == {'kind': 'joint_roam', 'partial_moves': True, 'max_candidates': 60, 'motion_logit_bias': 0, 'planner_fallback': False}
    assert runtime['inputs']['model_sha256'] == {p: m['sha256'] for p, m in lock['models'].items()}
    for preset, model in lock['models'].items():
        path = 'backend/app/policies/learned/checkpoints/' + model['file']
        assert hashlib.sha256(git_bytes(lock['source_commit'], path)).hexdigest() == model['sha256']
    for preset, digest in runtime['inputs']['native_fixtures'].items():
        path = f'backend/app/fixtures/plan-b/{preset}/scenario.pkl'
        assert hashlib.sha256(git_bytes(lock['source_commit'], path)).hexdigest() == digest == protocol['fixture_sha256'][path]
    assert set(runtime['inputs']['native_fixtures']) == set(PRESETS)


def normalized_reference(raw):
    if 'case' in raw:
        return normalized_pp(raw)
    result = {k: raw[k] for k in ('preset', 'departure_offsets', 'complete', 'arrived', 'lateness', 'makespan', 'horizon')}
    result['trains'] = raw['trains'] if 'trains' in raw else raw['total']
    assert raw.get('seed', 0) == 0
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('confirmation', 'domain'))
    parser.add_argument('--runtime', type=Path)
    parser.add_argument('--pp', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    protocol, reserved, dense = freeze_audit()
    lock_path = HERE / 'candidate-lock-v3.json'
    assert sha(lock_path) == LOCK
    lock = read(lock_path)
    assert lock['reserved_confirmation_manifest_sha256'] == FRESH
    assert lock['input_freeze_protocol_sha256'] == PROTOCOL
    assert lock['systematic_domain_manifest_sha256'] == DOMAIN
    assert lock['confirmation_outcomes_opened_at_selection'] is False and lock['no_tuning_after_confirmation'] is True
    known_path = HERE / 'known309-runtime-candidate3.json'
    assert sha(known_path) == lock['known309_report_sha256']
    known = read(known_path)
    assert known['source_commit'] == lock['source_commit'] and known['source_worktree_dirty'] is False
    assert known['inputs']['bundle_manifest_sha256'] == lock['bundle_manifest_sha256']
    if args.mode == 'confirmation':
        manifest_path = HERE / 'inputs/confirmation40-v3-cases.json'
        runtime_path = args.runtime or HERE / 'confirmation40-v3-runtime.json'
        pp_path = args.pp or HERE / 'confirmation40-v3-pp.json'
        expected_count, expected_trains = 40, 100
        output = args.output or HERE / 'confirmation40-v3-independent-audit.json'
    else:
        manifest_path = HERE / 'inputs/systematic1472-v3-cases.json'
        runtime_path = args.runtime
        assert runtime_path is not None, '--runtime identifies the complete private1472 raw report'
        pp_path = args.pp or HERE / 'pp-reference-systematic1472-v3.json'
        expected_count, expected_trains = 1472, 4316
        output = args.output or HERE / 'systematic1472-candidate3-vs-pp.json'
    runtime, pp = read(runtime_path), read(pp_path)
    verify_runtime(runtime, manifest_path, lock, protocol)
    if args.mode == 'confirmation':
        assert pp['manifest_sha256'] == FRESH
        pp_rows = pp['results']
    else:
        pp_rows = pp['records']
        # Each reference source is separately retained or identified by hash.
        assert len(pp_rows) == expected_count
    expected = {c['case_id']: c for c in read(manifest_path)['cases']}
    rr = {r['case_id']: r for r in runtime['results']}
    refs = {}
    for raw in pp_rows:
        b = normalized_reference(raw)
        physical = b['preset'], tuple(b['departure_offsets'])
        assert physical not in refs, 'No duplicate reference rows hidden by a dictionary'
        refs[physical] = (b, raw)
    assert len(expected) == len(rr) == len(runtime['results']) == len(refs) == expected_count
    assert set(rr) == set(expected) and set(refs) == {key(c) for c in expected.values()}
    records, errors = [], []
    for cid, case in expected.items():
        a = rr[cid]
        b, raw = refs[key(case)]
        assert canonical_case(a['case']) == canonical_case(case)
        assert a['horizon'] == b['horizon'] == HORIZONS[case['preset']]
        assert a['total'] == b['trains'] == (2 if case['preset'] == 'tutorial' else 3)
        if 'technical_error' in a:
            errors.append({'case_id': cid, 'runtime_error': a['technical_error']})
        else:
            model = lock['models'][case['preset']]
            assert a['selected_infrastructure'] == case['preset'] and a['checkpoint_sha256'] == model['sha256'] and a['checkpoint_file'] == model['file']
            assert a['planner_interventions'] == a['motion_logit_bias'] == 0 and a['policy'] == 'uc2_rl'
        if 'technical_error' in raw:
            errors.append({'case_id': cid, 'pp_error': raw['technical_error']})
        row = pair(case, a, b, 'fresh_reserved40' if key(case) in reserved else 'seen_train_or_development')
        row['selected_checkpoint_sha256'] = a.get('checkpoint_sha256')
        row['runtime_safety_counters'] = {k: a.get(k) for k in COUNTERS}
        witnesses = a.get('observed_malfunction_counter_increases', [])
        row['runtime_native_fault_witnesses'] = witnesses
        row['runtime_native_positive_counter_steps'] = a.get('native_on_map_positive_counter_steps')
        row['pp_native_fault_witnesses'] = raw.get('observed_malfunction_counter_increases', raw.get('native_fault_witnesses'))
        row['pp_native_fault_increase_count'] = raw.get('observed_native_fault_increases', len(row['pp_native_fault_witnesses']) if row['pp_native_fault_witnesses'] is not None else None)
        row['pp_source_sha256'] = raw.get('source_sha256', raw.get('source_artifact_sha256'))
        records.append(row)
    counts = {k: sum(r.get(k, 0) for r in rr.values()) for k in COUNTERS}
    total = sums(records)
    assert total['trains'] == expected_trains
    assert total['runtime_lateness'] == runtime['summary']['uc2_rl']['lateness']
    failures = [r for r in records if not r['runtime_complete'] or r['lateness_gap'] > 0]
    adverse_clean = all(counts[k] == 0 for k in ADVERSE)
    primary = not failures and not errors and adverse_clean and total['runtime_complete'] == total['pp_complete'] == expected_count
    data = {
        'schema': 'uc2-candidate3-final-independent-pairing-v1', 'audited_at_utc': datetime.now(timezone.utc).isoformat(),
        'mode': args.mode, 'candidate_frozen_at_utc': lock['frozen_at_utc'], 'source_commit': lock['source_commit'],
        'source_worktree_dirty': runtime['source_worktree_dirty'], 'all_source_hashes_verified_against_git': True,
        'identity_kind': 'multi-model-bundle', 'bundle_manifest_sha256': lock['bundle_manifest_sha256'],
        'candidate_checkpoint_sha256': None, 'models': lock['models'],
        'raw_runtime_report_sha256': sha(runtime_path), 'raw_runtime_report_rows': len(runtime['results']),
        'raw_runtime_published': args.mode == 'confirmation',
        'pp_reference_sha256': sha(pp_path), 'case_manifest_sha256': sha(manifest_path),
        'candidate_lock_sha256': sha(lock_path), 'input_protocol_sha256': PROTOCOL,
        'known309_report_sha256': sha(known_path), 'c3_training_input_exclusion_audit': dense,
        'summary': total, 'by_preset': {p: sums([r for r in records if r['preset'] == p]) for p in PRESETS if any(r['preset'] == p for r in records)},
        'runtime_audit_counters': counts, 'actual_uncached_post_step_reference_audit': True,
        'technical_errors': errors, 'primary_casewise_pp_gate_passed': primary,
        'primary_gate_failure_case_ids': [r['case_id'] for r in failures],
        'prior_failed84_and100_evidence_retained_and_hashes_verified': True,
        'fresh_scope': 'Exactly40 reserved inputs,20UC2-4 and20Tutorial. Other three maps have no newly reserved cases in this phase.',
        'domain_scope': '1472 is the complete finite offset domain: four native UC2 maps x7^3 plus Tutorial10^2. It includes seen TRAIN and selection inputs; it is not1472 independent blind tests.',
        'makespan_is_a_separate_metric': True, 'records': records,
        'latency_scope': runtime['latency_scope'],
        'limits': 'Same native fixtures,seed0,speed/fault schedules and original horizons. No runtime planner fallback or future-label access. No universal guarantee on untested maps, schedules or offset ranges. Audit warming prevents a production-throughput claim.',
        'audit_script_sha256': sha(__file__),
    }
    publish(output, data)
    print(json.dumps({'artifact': output.name, 'sha256': sha(output), 'summary': total,
                      'primary_gate_passed': primary, 'adverse_counters_clean': adverse_clean}))


if __name__ == '__main__':
    main()
