"""Final C4 tensor/known-domain audit, without training or policy execution.

All1472 inputs are now known. Original failed confirmations remain unchanged;
this audit makes no new holdout or unseen-map claim.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from audit_candidate2_development import canonical_case, key, pair, sums
from audit_candidate3_development import git_sha, primitive
from audit_candidate3_final import ADVERSE, COUNTERS, HORIZONS, PRESETS, freeze_audit, normalized_reference, verify_runtime

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CHECKPOINTS = ROOT / 'backend/app/policies/learned/checkpoints'
BUNDLE = 'c27f9a83af1a7a42c9bebec0cd8213889f1207ef883cbeb1dc74d1b629a1103d'
RECIPE = '2b1aee487dd11c38a3a65e8a87361b7832b8339ef541ff551c6a3957fe2d3156'
LOCK = 'fa178836225cea603de3bf3a9c2f01af0bdd3293ce74938a18d18da4ce7819cb'
SOURCE = 'e1b293364ae9b4ccbe0a39741f7836c55643ac5e'
TUTORIAL = '3a0c23ca3f7f50eeca5c7054f14e75a53dff82d300a593be91141c82eb265d02'


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def publish(name, data):
    path = HERE / name
    assert not path.exists(), 'Keep prior completed evidence immutable'
    text = json.dumps(data, indent=2) + '\n'
    assert all(x not in text for x in ('/private/tmp/', '/Users/', '/var/folders/'))
    path.write_text(text)
    return {'file': name, 'sha256': sha(path)}


def history():
    protocol, former_reserved, dense = freeze_audit()
    c3 = read(HERE / 'confirmation40-v3-independent-audit.json')
    assert c3['summary']['lateness_worse'] == 1 and not c3['primary_casewise_pp_gate_passed']
    assert c3['summary']['sum_positive_lateness_gap'] == 2
    assert sha(HERE / 'candidate-lock-v3.json') == c3['candidate_lock_sha256']
    assert sha(HERE / 'confirmation40-v3-runtime.json') == c3['raw_runtime_report_sha256']
    assert sha(HERE / 'confirmation40-v3-pp.json') == c3['pp_reference_sha256']
    return protocol, former_reserved, dense


def exports(args, bundle, lock):
    import torch
    torch.set_num_threads(1)
    assert sha(args.recipe) == RECIPE
    recipe = read(args.recipe)
    text = args.recipe.read_text()
    assert '/private/' not in text and '/Users/' not in text
    path = HERE / 'candidate4-selection-recipe.json'
    assert not path.exists()
    path.write_bytes(args.recipe.read_bytes())
    c3_bundle = read(HERE / 'candidate-lock-v3.json')
    records = []
    for preset in PRESETS:
        entry, spec = recipe['maps'][preset], bundle['models'][preset]
        source = args.sources / entry['checkpoint']
        exported = CHECKPOINTS / spec['file']
        assert sha(source) == entry['checkpoint_sha256'] == spec['source_checkpoint_sha256']
        assert sha(exported) == spec['sha256'] == git_sha(SOURCE, 'backend/app/policies/learned/checkpoints/' + spec['file'])
        a = torch.load(source, map_location='cpu', weights_only=True)
        b = torch.load(exported, map_location='cpu', weights_only=True)
        assert set(b) == {'model', 'meta'} and primitive(b['meta'])
        assert set(a['model']) == set(b['model'])
        h = hashlib.sha256()
        for name in sorted(a['model']):
            x, y = a['model'][name], b['model'][name]
            assert x.shape == y.shape and x.dtype == y.dtype
            assert x.contiguous().numpy().tobytes() == y.contiguous().numpy().tobytes()
            h.update(name.encode()); h.update(str(x.dtype).encode()); h.update(str(tuple(x.shape)).encode())
            h.update(x.contiguous().numpy().tobytes())
        assert h.hexdigest() == spec['model_tensor_sha256'] == b['meta']['model_tensor_sha256']
        assert b['meta']['observation_schema'] == 'uc2-context-v1' and b['meta']['obs_size'] == 313
        assert '/private/' not in json.dumps(b['meta']) and '/Users/' not in json.dumps(b['meta'])
        if preset != 'tutorial':
            assert spec == c3_bundle['models'][preset]
            assert sha(exported) == git_sha(c3_bundle['source_commit'], 'backend/app/policies/learned/checkpoints/' + spec['file'])
        else:
            assert sha(source) == TUTORIAL
            assert set(b['meta']['teacher_source_counts']) == {'native_strict_pp', 'c3_frozen_neural_prior'}
            assert b['meta']['training_hyperparameters']['gradient_updates'] == 50
        records.append({'preset': preset, 'source_file_name': source.name, 'source_checkpoint_sha256': sha(source),
            'export_file': spec['file'], 'export_checkpoint_sha256': sha(exported), 'model_tensor_sha256': h.hexdigest(),
            'state_dict_keys': len(a['model']), 'all_tensor_bytes_keys_shapes_dtype_equal': True,
            'weights_only_true_load_succeeded': True, 'primitive_metadata_only': True,
            'other_four_byte_identical_to_c3': preset != 'tutorial', 'obs_size': 313,
            'hidden_size': b['meta']['hidden_size'], 'teacher_source_counts': b['meta']['teacher_source_counts']})
    for name in ('uc2_demo_ppo.pt', 'pf_ch_demo_ppo.pt'):
        assert sha(CHECKPOINTS / name) == git_sha('45e171cb', 'backend/app/policies/learned/checkpoints/' + name)
    artifact = publish('expert-export-roundtrip-candidate4.json', {
        'schema': 'uc2-candidate4-five-model-tensor-audit-v1', 'audited_at_utc': datetime.now(timezone.utc).isoformat(),
        'source_commit': SOURCE, 'identity_kind': 'multi-model-bundle', 'bundle_manifest_sha256': BUNDLE,
        'candidate_checkpoint_sha256': None, 'recipe_sha256': RECIPE, 'five_models': records,
        'other_four_exports_byte_identical_to_c3': True, 'original_uc2_and_pf_ch_checkpoints_unchanged': True,
        'scope': 'The only new model is Tutorial. First50-update correction uses genuine PP44 plus frozen C3neural-prior4268 samples, explicitly distinguished. All100Tutorial inputs are known.',
        'audit_script_sha256': sha(__file__)})
    # A compact portable version of the independent known100 native witness.
    proof_path = args.tutorial_evidence / 'tutorial-c4.rawpp08-independent-native-proof.json'
    proof = read(proof_path)
    reference_path = args.tutorial_evidence / 'tutorial-c4.reference100.json'
    reference = read(reference_path)
    assert proof['checkpoint_sha256'] == reference['checkpoint_sha256'] == TUTORIAL
    assert proof['reference100_report_sha256'] == sha(reference_path)
    frame = proof['before_after']
    assert frame['strict_current_state_pp_action'] == frame['c4_selected_executed_action'] == 1
    assert frame['native_mask'] == frame['guarded_mask'] and frame['guarded_mask'][1] >= .5
    assert frame['strict_current_state_pp_proof']['accepted']
    assert reference['summary']['cases'] == reference['summary']['complete_missions'] == 100
    assert reference['summary']['lateness_regrets'] == reference['summary']['makespan_regrets'] == 0
    assert reference['actual_post_step_reference_audit'] is True
    compact_frame = {k: v for k, v in frame.items() if k != 'obs'}
    compact_frame['observation_sha256'] = hashlib.sha256(json.dumps(frame['obs'], separators=(',', ':')).encode()).hexdigest()
    witness = publish('tutorial-candidate4-native-correction-proof.json', {
        'schema': 'tutorial-candidate4-native-correction-proof-v1', 'checkpoint_sha256': TUTORIAL,
        'source_raw_proof_sha256': sha(proof_path), 'source_known100_report_sha256': sha(reference_path),
        'known100_summary': reference['summary'], 'before_after': compact_frame,
        'actual_uncached_post_step_reference_audit': True,
        'scope': 'Known100 Tutorial regression and one current-state native PP action witness. Not a new holdout. The original C3fresh40 failure is unchanged.',
        'audit_script_sha256': sha(__file__)})
    return [artifact, witness]


def domain(args, lock, protocol, former_reserved):
    path = args.runtime
    assert path is not None
    runtime = read(path)
    manifest_path = HERE / 'inputs/systematic1472-v3-cases.json'
    reference_path = HERE / 'pp-reference-systematic1472-v3.json'
    pp = read(reference_path)
    assert sha(manifest_path) == lock['systematic_domain_manifest_sha256']
    assert sha(reference_path) == lock['pp_reference_sha256']
    pp_audit = read(HERE / 'pp-reference-systematic1472-independent-audit.json')
    assert pp_audit['reference_sha256'] == sha(reference_path) and pp_audit['all1472_reference_rows_match_original_native_report'] is True
    verify_runtime(runtime, manifest_path, lock, protocol)
    cases = {c['case_id']: c for c in read(manifest_path)['cases']}
    rr = {r['case_id']: r for r in runtime['results']}
    refs = {}
    for raw in pp['records']:
        k = raw['preset'], tuple(raw['departure_offsets'])
        assert k not in refs
        refs[k] = raw
    assert len(cases) == len(rr) == len(runtime['results']) == len(refs) == 1472
    assert set(cases) == set(rr) and set(refs) == {key(c) for c in cases.values()}
    records, errors = [], []
    for cid, case in cases.items():
        a, ref = rr[cid], refs[key(case)]
        b = normalized_reference(ref)
        assert canonical_case(a['case']) == canonical_case(case)
        assert a['horizon'] == b['horizon'] == HORIZONS[case['preset']]
        assert a['total'] == b['trains'] == (2 if case['preset'] == 'tutorial' else 3)
        if 'technical_error' in a:
            errors.append({'case_id': cid, 'runtime_error': a['technical_error']})
        else:
            model = lock['models'][case['preset']]
            assert a['selected_infrastructure'] == case['preset'] and a['checkpoint_sha256'] == model['sha256'] and a['checkpoint_file'] == model['file']
            assert a['policy'] == 'uc2_rl' and a['planner_interventions'] == a['motion_logit_bias'] == 0
            assert all(k in a for k in COUNTERS)
        r = pair(case, a, b, 'known_finite_domain_regression')
        r['was_reserved_for_C3'] = key(case) in former_reserved
        r['is_new_holdout_for_C4'] = False
        r['selected_checkpoint_sha256'] = a.get('checkpoint_sha256')
        r['runtime_safety_counters'] = {k: a.get(k) for k in COUNTERS}
        r['runtime_native_fault_witnesses'] = a.get('observed_malfunction_counter_increases', [])
        r['runtime_native_positive_counter_steps'] = a.get('native_on_map_positive_counter_steps')
        r['pp_native_fault_witnesses'] = ref['observed_malfunction_counter_increases']
        r['pp_native_fault_increase_count'] = ref['observed_native_fault_increases']
        r['pp_source_sha256'] = ref['source_sha256']
        records.append(r)
    counts = {k: sum(a.get(k, 0) for a in rr.values()) for k in COUNTERS}
    total = sums(records)
    assert total['runtime_lateness'] == runtime['summary']['uc2_rl']['lateness']
    assert total['pp_lateness'] == pp['lateness'] == 43599
    assert total['trains'] == 4316
    failures = [r for r in records if not r['runtime_complete'] or r['lateness_gap'] > 0]
    adverse_clean = all(counts[k] == 0 for k in ADVERSE)
    passed = not errors and not failures and adverse_clean and total['runtime_complete'] == total['pp_complete'] == 1472
    artifact = publish('systematic1472-candidate4-vs-pp.json', {
        'schema': 'uc2-candidate4-final-known-domain-independent-pairing-v1',
        'audited_at_utc': datetime.now(timezone.utc).isoformat(), 'source_commit': SOURCE,
        'source_worktree_dirty': runtime['source_worktree_dirty'], 'all_source_hashes_verified_against_git': True,
        'identity_kind': 'multi-model-bundle', 'bundle_manifest_sha256': BUNDLE,
        'candidate_checkpoint_sha256': None, 'models': lock['models'],
        'raw_runtime_report_sha256': sha(path), 'raw_runtime_report_rows': len(runtime['results']),
        'raw_runtime_published': False, 'pp_reference_sha256': sha(reference_path),
        'pp_original_source_independent_audit_sha256': sha(HERE / 'pp-reference-systematic1472-independent-audit.json'),
        'case_manifest_sha256': sha(manifest_path), 'regression_lock_sha256': LOCK,
        'summary': total, 'by_preset': {p: sums([r for r in records if r['preset'] == p]) for p in PRESETS},
        'runtime_audit_counters': counts, 'technical_errors': errors,
        'actual_uncached_post_step_reference_audit': True, 'primary_casewise_pp_gate_passed': passed,
        'primary_gate_failure_case_ids': [r['case_id'] for r in failures],
        'previous_failed_confirmations_preserved': ['confirmation84-independent-audit.json', 'confirmation100-v2-independent-audit.json', 'confirmation40-v3-independent-audit.json'],
        'no_new_holdout_claim': True, 'scope': 'All1472 inputs are known TRAIN/development/regression. The complete declared finite same-fixture domain is fourUC2 maps x7^3 plus Tutorial10^2. C3fresh40 remains its original failed confirmation.',
        'makespan_is_separate_metric': True, 'records': records,
        'latency_scope': runtime['latency_scope'],
        'limits': 'Native seed0,horizons,speeds,fault schedules unchanged. No runtime planner fallback, case-ID lookup or future-fault labels. No universal claim for untested maps, incidents or ranges; audit timing is not production-throughput evidence.',
        'audit_script_sha256': sha(__file__)})
    if passed:
        status_path = HERE / 'current-status.json'
        status = read(status_path)
        status['schema'] = 'uc2-roam-performance-current-status-v4'
        status['recorded_at_utc'] = datetime.now(timezone.utc).isoformat()
        status['stage'] = 'Candidate4 passed the complete known1472 finite-domain per-case lateness comparison.'
        status['primary_target_achieved_on_declared_finite_domain'] = True
        status['primary_target_achieved_on_fresh_confirmation'] = False
        status['candidate4'] = {'source_commit': SOURCE, 'bundle_manifest_sha256': BUNDLE,
            'status': 'Final actual registered replay, all1472 complete and per-case native lateness no worse than fixed PP.',
            'summary': total, 'by_preset': {p: sums([r for r in records if r['preset'] == p]) for p in PRESETS},
            'runtime_audit_counters': counts, 'independent_audit': artifact,
            'no_new_holdout_claim': True, 'all_inputs_known': True,
            'C3fresh40_failed_result_retained': True, 'makespan_is_separate_tradeoff': True}
        status['evidence_interpretation'] = 'C4 fixes the remaining known Tutorial error. All1472 declared finite-domain cases now pass per-case lateness, including training and earlier opened confirmations. Earlier fresh84/fresh100/fresh40 failure evidence remains unchanged. This does not establish a new independent holdout or universal performance guarantee. Makespan remains separate.'
        status_path.write_text(json.dumps(status, indent=2) + '\n')
    return artifact, total, passed, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--sources', type=Path)
    parser.add_argument('--tutorial-evidence', type=Path)
    parser.add_argument('--runtime', type=Path)
    exclusive = parser.add_mutually_exclusive_group()
    exclusive.add_argument('--exports-only', action='store_true')
    exclusive.add_argument('--domain-only', action='store_true')
    args = parser.parse_args()
    protocol, former_reserved, _ = history()
    lock_path = HERE / 'final-regression-lock-v4.json'
    assert sha(lock_path) == LOCK
    lock = read(lock_path)
    assert lock['source_commit'] == SOURCE and lock['bundle_manifest_sha256'] == BUNDLE
    assert lock['has_unopened_same_domain_tutorial_holdout'] is False and lock['no_tuning_after_this_lock'] is True
    bundle_path = CHECKPOINTS / 'uc2_roam_specialists.json'
    assert sha(bundle_path) == BUNDLE
    bundle = read(bundle_path)
    assert bundle['selection_sha256'] == RECIPE and bundle['models'] == lock['models']
    results = []
    if not args.domain_only:
        assert args.recipe is not None and args.sources is not None and args.tutorial_evidence is not None
        results.extend(exports(args, bundle, lock))
    if not args.exports_only:
        result, total, passed, counts = domain(args, lock, protocol, former_reserved)
        results.append(result)
        print(json.dumps({'summary': total, 'primary_gate_passed': passed, 'counters': counts}))
    print(json.dumps({'artifacts': results}))


if __name__ == '__main__':
    main()
