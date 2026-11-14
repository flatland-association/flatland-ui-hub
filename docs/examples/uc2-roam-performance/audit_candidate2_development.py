"""Independently audit exported C2 weights and complete known/TRAIN results.

This helper performs no rollout or training and never reads confirmation100
outcomes. Private source directories are explicit inputs, never published.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASELINE = '01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668'
BUNDLE = '4971b7257c6c9f2e574bc5795af4346f40676f68becc333bcd283dd65212125e'
RECIPE = '5f0aca77a7ce1b2217cdd465665c6ba0b36924acc3ed3fc3601f431e9d6278bf'
PRESETS = ('tutorial', 'uc2-1', 'uc2-2', 'uc2-3', 'uc2-4')
COUNTERS = ('reference_disagreements', 'new_stuck_steps', 'uncertified_steps',
            'prediction_mismatches', 'resource_conflicts', 'planner_interventions')


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def key(case):
    return case['preset'], tuple(case.get('departure_offsets') or (0,) * (2 if case['preset'] == 'tutorial' else 3))


def canonical_case(case):
    return {'preset': case['preset'], 'case_id': case['case_id'],
            'seed': case.get('seed', 0), 'departure_offsets': list(key(case)[1]),
            'disturbance_ids': case.get('disturbance_ids', []),
            'disturbances': case.get('disturbances', []), 'horizon': case.get('horizon')}


def save(name, data):
    path = HERE / name
    if path.exists():
        raise FileExistsError(f'Preserve existing evidence: {name}')
    text = json.dumps(data, indent=2) + '\n'
    assert all(s not in text for s in ('/private/tmp/', '/Users/', '/var/folders/'))
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(text)
    temporary.replace(path)
    return {'file': name, 'sha256': sha(path)}


def git_sha(commit, path):
    return hashlib.sha256(subprocess.check_output(['git', 'show', f'{commit}:{path}'], cwd=ROOT)).hexdigest()


def sums(rows):
    return {'cases': len(rows), 'runtime_complete': sum(r['runtime_complete'] for r in rows),
            'pp_complete': sum(r['pp_complete'] for r in rows),
            'runtime_arrived': sum(r['runtime_arrived'] for r in rows),
            'pp_arrived': sum(r['pp_arrived'] for r in rows), 'trains': sum(r['trains'] for r in rows),
            'runtime_lateness': sum(r['runtime_lateness'] for r in rows),
            'pp_lateness': sum(r['pp_lateness'] for r in rows),
            'lateness_better': sum(r['lateness_gap'] < 0 for r in rows),
            'lateness_equal': sum(r['lateness_gap'] == 0 for r in rows),
            'lateness_worse': sum(r['lateness_gap'] > 0 for r in rows),
            'sum_positive_lateness_gap': sum(max(0, r['lateness_gap']) for r in rows),
            'worst_lateness_gap': max(r['lateness_gap'] for r in rows),
            'makespan_better': sum(r['makespan_gap'] < 0 for r in rows),
            'makespan_equal': sum(r['makespan_gap'] == 0 for r in rows),
            'makespan_worse': sum(r['makespan_gap'] > 0 for r in rows),
            'worst_makespan_gap': max(r['makespan_gap'] for r in rows)}


def pair(case, a, b, cohort):
    # b is a normalized fixed PP reference, not a selected alternative plan.
    assert key(case) == (b['preset'], tuple(b['departure_offsets']))
    assert a['horizon'] == b['horizon'] and a['total'] == b['trains']
    return {'case_id': case['case_id'], 'cohort': cohort, 'preset': case['preset'],
            'departure_offsets': list(key(case)[1]), 'horizon': a['horizon'],
            'runtime_complete': a['complete_mission'], 'pp_complete': b['complete'],
            'runtime_arrived': a['arrived'], 'pp_arrived': b['arrived'], 'trains': a['total'],
            'runtime_lateness': a['lateness'], 'pp_lateness': b['lateness'],
            'lateness_gap': a['lateness'] - b['lateness'],
            'runtime_makespan': a['steps'], 'pp_makespan': b['makespan'],
            'makespan_gap': a['steps'] - b['makespan']}


def normalized_pp(row):
    return {'preset': row['case']['preset'], 'departure_offsets': list(key(row['case'])[1]),
            'complete': row['complete_mission'], 'arrived': row['arrived'], 'trains': row['total'],
            'lateness': row['lateness'], 'makespan': row['steps'], 'horizon': row['horizon']}


def roundtrip(args, recipe, bundle, stamp):
    import torch
    torch.set_num_threads(1)
    records = []
    for preset in ('uc2-1', 'uc2-2', 'uc2-4'):
        selected = recipe['maps'][preset]
        source = args.sources / selected['checkpoint']
        spec = bundle['models'][preset]
        export = args.exports / spec['file']
        shipped = ROOT / 'backend/app/policies/learned/checkpoints' / spec['file']
        assert sha(source) == selected['checkpoint_sha256'] == spec['source_checkpoint_sha256']
        assert sha(export) == sha(shipped) == spec['sha256']
        a = torch.load(source, map_location='cpu', weights_only=True)
        b = torch.load(export, map_location='cpu', weights_only=True)
        assert set(b) == {'model', 'meta'} and set(a['model']) == set(b['model'])
        tensor_hash = hashlib.sha256()
        for name in sorted(a['model']):
            x, y = a['model'][name], b['model'][name]
            assert x.shape == y.shape and x.dtype == y.dtype
            assert x.contiguous().numpy().tobytes() == y.contiguous().numpy().tobytes()
            tensor_hash.update(name.encode())
            tensor_hash.update(str(x.dtype).encode())
            tensor_hash.update(str(tuple(x.shape)).encode())
            tensor_hash.update(x.contiguous().numpy().tobytes())
        assert tensor_hash.hexdigest() == spec['model_tensor_sha256'] == b['meta']['model_tensor_sha256']
        assert b['meta']['observation_schema'] == 'uc2-context-v1' and b['meta']['obs_size'] == 313
        metadata_text = json.dumps(b['meta'])
        assert all(s not in metadata_text for s in ('/Users/', '/private/', '/var/folders/'))
        records.append({'preset': preset, 'source_file_name': source.name,
                        'source_checkpoint_sha256': sha(source), 'export_file': export.name,
                        'export_checkpoint_sha256': sha(export),
                        'model_tensor_sha256': tensor_hash.hexdigest(),
                        'state_dict_keys': len(a['model']), 'all_tensor_bytes_dtype_shape_keys_equal': True,
                        'weights_only_true_load_succeeded': True, 'shipped_file_equals_export': True,
                        'export_contains_only_model_and_allowlisted_primitive_meta': True,
                        'input_width': 313, 'hidden_size': b['meta']['hidden_size'],
                        'observation_schema': b['meta']['observation_schema']})
    baseline = ROOT / 'backend/app/policies/learned/checkpoints/uc2_demo_ppo.pt'
    assert sha(baseline) == BASELINE
    old = read(HERE / 'expert-export-roundtrip.json')
    old_uc24 = next(r for r in old['new_expert_exports'] if r['preset'] == 'uc2-4')
    assert old_uc24['model_tensor_sha256_recorded_in_manifest'] == bundle['models']['uc2-4']['model_tensor_sha256']
    return save('expert-export-roundtrip-candidate2.json', {
        'schema': 'uc2-roam-expert-export-roundtrip-v2', 'verified_at_utc': stamp,
        'method': 'Independent CPU weights-only loads and comparison of every state-dictionary key, dtype, shape and tensor byte. No inference, rollout or training.',
        'bundle_manifest_sha256': BUNDLE, 'identity_kind': 'multi-model-bundle',
        'bundle_hash_is_not_a_checkpoint_hash': True, 'baseline_checkpoint_sha256': BASELINE,
        'baseline_identity_unchanged': True, 'uc2_4_tensor_identity_unchanged_from_candidate1': True,
        'uc2_4_export_bytes_changed_only_in_metadata': True,
        'new_expert_exports': records, 'audit_script_sha256': sha(__file__)})


def dense(args, recipe, stamp):
    maps = {}
    for preset, report_name in [('uc2-1', 'uc21-refine22-epoch250-train323-v3.json'),
                                ('uc2-2', 'uc22-epoch1000-train323-v3.json')]:
        path = args.training / report_name
        report = read(path)
        teacher_path = args.training / f'{preset}-323-teacher.manifest.json'
        teacher = read(teacher_path)
        cases_path = HERE / f'inputs/dense-v2-{preset}-train-cases.json'
        cases = read(cases_path)['cases']
        expected = {c['case_id']: c for c in cases}
        rr = {r['case_id']: r for r in report['results']}
        pp = {r['case']['case_id']: r for r in teacher['cases']}
        assert len(expected) == len(rr) == len(report['results']) == len(pp) == 323
        assert set(expected) == set(rr) == set(pp)
        assert sha(path) == recipe['dense323_train_outcomes'][preset]['report_sha256']
        assert report['inputs']['checkpoint_sha256'] == recipe['maps'][preset]['checkpoint_sha256']
        assert report['inputs']['manifest_sha256'] == teacher['case_manifest_sha256'] == sha(cases_path)
        assert teacher['reserved_manifest_sha256'] == recipe['reserved100_manifest_sha256']
        assert teacher['reserved_outcomes_used'] is False and teacher['reserved_exclusion_count'] == 20
        assert report['source_hashes_unchanged_during_run'] is True
        records = []
        for cid, case in expected.items():
            a, entry = rr[cid], pp[cid]
            assert entry['accepted'] and a['case'] == case == entry['case']
            assert 'technical_error' not in a and a['planner_interventions'] == 0
            records.append(pair(case, a, normalized_pp(entry['metrics']), 'seen_dense_train'))
        counts = {k: sum(r.get(k, 0) for r in rr.values()) for k in COUNTERS}
        summary = sums(records)
        assert summary['runtime_complete'] == summary['pp_complete'] == 323
        assert summary['lateness_worse'] == 0 and summary['runtime_lateness'] == summary['pp_lateness']
        assert not any(counts.values())
        maps[preset] = {'summary': summary, 'runtime_audit_counters': counts,
            'student_report': report_name, 'student_report_sha256': sha(path),
            'teacher_manifest_name': teacher_path.name, 'teacher_manifest_sha256': sha(teacher_path),
            'teacher_dataset_sha256': teacher['dataset_sha256'], 'teacher_rows': teacher['rows'],
            'train_case_manifest': f'inputs/{cases_path.name}', 'train_manifest_sha256': sha(cases_path),
            'source_checkpoint_sha256': report['inputs']['checkpoint_sha256'],
            'source_commit_reported_by_student_run': report['source_commit'],
            'source_sha256_reported_by_student_run': report['source_sha256'],
            'records': records}
    return save('dense-v2-training-outcomes-summary.json', {
        'schema': 'uc2-roam-dense-training-audit-v2', 'verified_at_utc': stamp,
        'scope': 'Seen TRAIN inputs: each map has 343 possible offset triples minus the 20 reserved confirmation triples, leaving 323. These are not blind generalization results.',
        'reserved100_outcomes_read': False, 'maps': maps, 'audit_script_sha256': sha(__file__)})


def known209(bundle, stamp):
    lock_path = HERE / 'candidate-lock-v2.json'
    lock = read(lock_path)
    path = HERE / 'known209-runtime-candidate2.json'
    report = read(path)
    assert sha(path) == lock['known209_report_sha256']
    assert report['inputs']['bundle_manifest_sha256'] == BUNDLE == lock['bundle_manifest_sha256']
    assert report['inputs']['model_sha256'] == {p: v['sha256'] for p, v in bundle['models'].items()}
    assert report['source_sha256'] == lock['source_sha256']
    for rel, source_sha in report['source_sha256'].items():
        assert git_sha(lock['source_commit'], 'backend/' + rel) == source_sha
    for preset, fixture_sha in report['inputs']['native_fixtures'].items():
        assert git_sha(lock['source_commit'], f'backend/app/fixtures/plan-b/{preset}/scenario.pkl') == fixture_sha
    manifest_path = HERE / 'inputs/known209-development-cases.json'
    assert sha(manifest_path) == report['inputs']['case_manifest_sha256']
    expected = {c['case_id']: c for c in read(manifest_path)['cases']}
    rr = {r['case_id']: r for r in report['results']}
    refs_path = HERE / 'pp-reference-known125.json'
    refs = {r['case_id']: r for r in read(refs_path)['records']}
    old84_path = HERE / 'confirmation84-pp.json'
    for row in read(old84_path)['results']:
        assert row['case_id'] not in refs
        refs[row['case_id']] = {**normalized_pp(row), 'cohort': 'former_confirmation84_now_development'}
    assert len(expected) == len(rr) == len(report['results']) == len(refs) == 209
    assert set(expected) == set(rr) == set(refs)
    records = []
    for cid, case in expected.items():
        a, b = rr[cid], refs[cid]
        assert canonical_case(a['case']) == canonical_case(case) and 'technical_error' not in a
        spec = bundle['models'][case['preset']]
        assert a['policy'] == 'uc2_rl' and a['selected_infrastructure'] == case['preset']
        assert a['checkpoint_sha256'] == spec['sha256'] and a['checkpoint_file'] == spec['file']
        assert a['motion_logit_bias'] == 0 and a['planner_interventions'] == 0
        record = pair(case, a, b, b['cohort'])
        record['selected_checkpoint_sha256'] = a['checkpoint_sha256']
        records.append(record)
    counts = {k: sum(r.get(k, 0) for r in rr.values()) for k in COUNTERS}
    total = sums(records)
    assert total['runtime_complete'] == total['pp_complete'] == 209
    assert total['runtime_arrived'] == total['pp_arrived'] == total['trains'] == 598
    assert total['runtime_lateness'] == 4583 and total['pp_lateness'] == 5829 and total['lateness_worse'] == 0
    assert not any(counts.values())
    return save('known209-candidate2-vs-pp.json', {
        'schema': 'uc2-roam-known209-candidate2-independent-join-v1', 'verified_at_utc': stamp,
        'scope': 'All known209 development inputs, including the failed first84 confirmation now used for improvement. This is not a new blind confirmation.',
        'identity_kind': 'multi-model-bundle', 'bundle_manifest_sha256': BUNDLE,
        'candidate_checkpoint_sha256': None, 'models': bundle['models'],
        'runtime_report_sha256': sha(path), 'pp_known125_reference_sha256': sha(refs_path),
        'pp_former84_reference_sha256': sha(old84_path), 'known209_manifest_sha256': sha(manifest_path),
        'candidate_lock_v2_sha256': sha(lock_path), 'frozen_candidate_commit': lock['source_commit'],
        'runtime_reported_commit': report['source_commit'],
        'runtime_reported_source_dirty': report['source_worktree_dirty'],
        'report_source_hashes_equal_frozen_commit': True,
        'source_provenance_note': 'Known209 was executed before the final commit; every recorded runtime source hash, model, fixture and manifest matches the later frozen candidate lock. Do not relabel the original report as a clean-commit run.',
        'summary': total, 'by_preset': {p: sums([r for r in records if r['preset'] == p]) for p in PRESETS},
        'by_cohort': {p: sums([r for r in records if r['cohort'] == p]) for p in sorted({r['cohort'] for r in records})},
        'runtime_audit_counters': counts, 'primary_casewise_pp_gate_passed': True,
        'makespan_gate_separate': True, 'records': records,
        'audit_script_sha256': sha(__file__)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--training', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--exports', type=Path, required=True)
    parser.add_argument('--known-only', action='store_true', help='Preserve already completed recipe, roundtrip and TRAIN audits')
    args = parser.parse_args()
    recipe_path = args.training / 'map-expert-selection-v2.json'
    assert sha(recipe_path) == RECIPE
    recipe = read(recipe_path)
    assert recipe['reserved100_outcomes_opened'] is False
    assert recipe['summary']['cases'] == 209 and recipe['summary']['worse_cases'] == 0
    recipe_bytes = recipe_path.read_bytes()
    assert all(s not in recipe_bytes for s in (b'/private/tmp/', b'/Users/', b'/var/folders/'))
    target = HERE / 'candidate2-selection-recipe.json'
    if args.known_only:
        assert sha(target) == RECIPE
    else:
        assert not target.exists()
        target.write_bytes(recipe_bytes)
    bundle_path = args.exports / 'uc2_roam_specialists.json'
    assert sha(bundle_path) == BUNDLE
    shipped_bundle = ROOT / 'backend/app/policies/learned/checkpoints/uc2_roam_specialists.json'
    assert sha(shipped_bundle) == BUNDLE
    bundle = read(bundle_path)
    assert bundle['selection_sha256'] == RECIPE
    stamp = datetime.now(timezone.utc).isoformat()
    artifacts = [{'file': target.name, 'sha256': sha(target)}]
    if not args.known_only:
        artifacts.append(roundtrip(args, recipe, bundle, stamp))
        artifacts.append(dense(args, recipe, stamp))
    artifacts.append(known209(bundle, stamp))
    print(json.dumps({'artifacts': artifacts, 'new100_outcomes_read': False}))


if __name__ == '__main__':
    main()
