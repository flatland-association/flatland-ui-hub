"""C3 five-model tensor roundtrip and complete known309 comparison; no rollouts."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

from audit_candidate2_development import canonical_case, key, normalized_pp, pair, sums

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CHECKPOINTS = ROOT / 'backend/app/policies/learned/checkpoints'
BUNDLE_SHA = 'd71497df9c572c12f408162dfa0351ef11492f1c1a284f865890491bd1eb4507'
RECIPE_SHA = '0b1a8632f92fff52986902db7d9947b7daee10522249800dba7083bc357f710a'
SOURCE = '23b68a941cd3b8334f2ffbd68a4b87b9f095180c'
BASELINE = '01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668'
PRESETS = ('tutorial', 'uc2-1', 'uc2-2', 'uc2-3', 'uc2-4')


def read(p):
    return json.loads(Path(p).read_text())


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def git_sha(commit, path):
    return hashlib.sha256(subprocess.check_output(['git', 'show', f'{commit}:{path}'], cwd=ROOT)).hexdigest()


def publish(name, data):
    p = HERE / name
    assert not p.exists(), 'Preserve completed evidence'
    text = json.dumps(data, indent=2) + '\n'
    assert all(x not in text for x in ('/private/tmp/', '/Users/', '/var/folders/'))
    p.write_text(text)
    return {'file': name, 'sha256': sha(p)}


def primitive(value):
    if value is None or type(value) in (str, int, float, bool):
        return True
    if isinstance(value, list):
        return all(primitive(x) for x in value)
    if isinstance(value, dict):
        return all(isinstance(k, str) and primitive(v) for k, v in value.items())
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    args = parser.parse_args()
    assert sha(args.recipe) == RECIPE_SHA
    recipe = read(args.recipe)
    assert set(recipe['maps']) == set(PRESETS)
    serialized_recipe = args.recipe.read_text()
    assert '/private/' not in serialized_recipe and '/Users/' not in serialized_recipe
    recipe_copy = HERE / 'candidate3-selection-recipe.json'
    assert not recipe_copy.exists()
    recipe_copy.write_bytes(args.recipe.read_bytes())
    bundle_path = CHECKPOINTS / 'uc2_roam_specialists.json'
    assert sha(bundle_path) == BUNDLE_SHA
    bundle = read(bundle_path)
    assert bundle['selection_sha256'] == RECIPE_SHA
    assert bundle['selector'] == 'immutable_native_fixture_identity_only'
    assert bundle['guard'] == {'kind': 'joint_roam', 'partial_moves': True, 'max_candidates': 60, 'motion_logit_bias': 0, 'planner_fallback': False}
    stamp = datetime.now(timezone.utc).isoformat()
    import torch
    torch.set_num_threads(1)
    tensor_records = []
    for preset in PRESETS:
        selected, spec = recipe['maps'][preset], bundle['models'][preset]
        source, exported = args.sources / selected['checkpoint'], CHECKPOINTS / spec['file']
        assert sha(source) == selected['checkpoint_sha256'] == spec['source_checkpoint_sha256']
        assert sha(exported) == spec['sha256'] == git_sha(SOURCE, 'backend/app/policies/learned/checkpoints/' + spec['file'])
        a = torch.load(source, map_location='cpu', weights_only=True)
        b = torch.load(exported, map_location='cpu', weights_only=True)
        assert set(b) == {'model', 'meta'} and primitive(b['meta'])
        assert set(a['model']) == set(b['model'])
        h = hashlib.sha256()
        for k in sorted(a['model']):
            x, y = a['model'][k], b['model'][k]
            assert x.dtype == y.dtype and x.shape == y.shape
            assert x.contiguous().numpy().tobytes() == y.contiguous().numpy().tobytes()
            h.update(k.encode()); h.update(str(x.dtype).encode()); h.update(str(tuple(x.shape)).encode())
            h.update(x.contiguous().numpy().tobytes())
        assert h.hexdigest() == spec['model_tensor_sha256'] == b['meta']['model_tensor_sha256']
        assert b['meta']['obs_size'] == 313 and b['meta']['observation_schema'] == 'uc2-context-v1'
        assert primitive(b['meta']) and '/private/' not in json.dumps(b['meta']) and '/Users/' not in json.dumps(b['meta'])
        if preset == 'uc2-3':
            assert set(b['meta']['teacher_source_counts']) == {'old_frozen_neural_prior', 'native_strict_pp', 'native_strict_pp_roam_safe_stop_projection'}
            assert b['meta']['teacher_source_counts']['native_strict_pp_roam_safe_stop_projection'] == 7
        tensor_records.append({'preset': preset, 'source_file_name': source.name,
            'source_checkpoint_sha256': sha(source), 'export_file': spec['file'],
            'export_checkpoint_sha256': sha(exported), 'model_tensor_sha256': h.hexdigest(),
            'state_dict_keys': len(a['model']), 'all_keys_dtype_shape_and_tensor_bytes_equal': True,
            'weights_only_true_load_succeeded': True, 'export_only_model_and_primitive_metadata': True,
            'obs_size': b['meta']['obs_size'], 'hidden_size': b['meta']['hidden_size'],
            'label_source_counts': b['meta']['teacher_source_counts']})
    baseline = CHECKPOINTS / 'uc2_demo_ppo.pt'
    pfch = CHECKPOINTS / 'pf_ch_demo_ppo.pt'
    assert sha(baseline) == BASELINE == git_sha('45e171cb', 'backend/app/policies/learned/checkpoints/uc2_demo_ppo.pt')
    assert sha(pfch) == git_sha('45e171cb', 'backend/app/policies/learned/checkpoints/pf_ch_demo_ppo.pt')
    outputs = [publish('expert-export-roundtrip-candidate3.json', {
        'schema': 'uc2-candidate3-five-model-tensor-audit-v1', 'audited_at_utc': stamp,
        'bundle_manifest_sha256': BUNDLE_SHA, 'identity_kind': 'multi-model-bundle',
        'candidate_checkpoint_sha256': None, 'recipe_sha256': RECIPE_SHA,
        'source_commit': SOURCE, 'five_expert_exports': tensor_records,
        'baseline_uc2_checkpoint_unchanged': True, 'baseline_uc2_checkpoint_sha256': BASELINE,
        'pf_ch_checkpoint_unchanged': True, 'pf_ch_checkpoint_sha256': sha(pfch),
        'uc23_projected_and_neural_prior_labels_explicitly_distinguished_from_raw_pp': True,
        'method': 'Independent CPU weights-only loads; all state-dictionary bytes compared. No inference, training, rollout or new40 outcome access.',
        'audit_script_sha256': sha(__file__)})]
    runtime_path = HERE / 'known309-runtime-candidate3.json'
    runtime = read(runtime_path)
    assert runtime['source_commit'] == SOURCE and runtime['source_worktree_dirty'] is False
    assert runtime['inputs']['bundle_manifest_sha256'] == BUNDLE_SHA
    assert runtime['inputs']['model_sha256'] == {p: x['sha256'] for p, x in bundle['models'].items()}
    for rel, h in runtime['source_sha256'].items():
        assert git_sha(SOURCE, 'backend/' + rel) == h
    for preset, h in runtime['inputs']['native_fixtures'].items():
        assert git_sha(SOURCE, f'backend/app/fixtures/plan-b/{preset}/scenario.pkl') == h
    manifest_path = HERE / 'inputs/known309-development-v3-cases.json'
    assert runtime['inputs']['case_manifest_sha256'] == sha(manifest_path)
    expected = {c['case_id']: c for c in read(manifest_path)['cases']}
    rr = {r['case_id']: r for r in runtime['results']}
    reference_path = HERE / 'pp-reference-known309-development-v3.json'
    refs = {r['case_id']: r for r in read(reference_path)['records']}
    assert len(expected) == len(rr) == len(runtime['results']) == len(refs) == 309
    assert set(expected) == set(rr) == set(refs)
    records = []
    for cid, case in expected.items():
        r = rr[cid]
        assert canonical_case(r['case']) == canonical_case(case) and 'technical_error' not in r
        spec = bundle['models'][case['preset']]
        assert r['selected_infrastructure'] == case['preset'] and r['checkpoint_sha256'] == spec['sha256'] and r['checkpoint_file'] == spec['file']
        assert r['planner_interventions'] == r['motion_logit_bias'] == 0 and r['policy'] == 'uc2_rl'
        record = pair(case, r, refs[cid], refs[cid]['cohort'])
        record['selected_checkpoint_sha256'] = r['checkpoint_sha256']
        records.append(record)
    counters = {k: sum(r.get(k, 0) for r in rr.values()) for k in ('reference_disagreements', 'new_stuck_steps',
        'uncertified_steps', 'resource_conflicts', 'prediction_mismatches', 'prediction_mismatches_with_new_fault', 'withdrawals', 'planner_interventions')}
    assert all(counters[k] == 0 for k in ('reference_disagreements', 'new_stuck_steps', 'uncertified_steps', 'resource_conflicts', 'prediction_mismatches', 'planner_interventions'))
    summary = sums(records)
    assert summary['runtime_complete'] == summary['pp_complete'] == 309
    assert summary['runtime_arrived'] == summary['pp_arrived'] == summary['trains'] == 878
    assert summary['runtime_lateness'] == 6716 and summary['pp_lateness'] == 8521 and summary['lateness_worse'] == 0
    outputs.append(publish('known309-candidate3-vs-pp.json', {
        'schema': 'uc2-candidate3-known309-independent-join-v1', 'audited_at_utc': stamp,
        'scope': 'Complete known309 DEVELOPMENT comparison, including both opened failed confirmations. Not a blind confirmation.',
        'source_commit': SOURCE, 'source_worktree_dirty': False, 'source_hashes_verified_against_git': True,
        'identity_kind': 'multi-model-bundle', 'bundle_manifest_sha256': BUNDLE_SHA,
        'candidate_checkpoint_sha256': None, 'models': bundle['models'],
        'input_sha256': {'runtime': sha(runtime_path), 'pp_reference': sha(reference_path), 'manifest': sha(manifest_path)},
        'summary': summary, 'by_preset': {p: sums([r for r in records if r['preset'] == p]) for p in PRESETS},
        'runtime_audit_counters': counters, 'primary_casewise_lateness_gate_passed': True,
        'makespan_compared_separately': True, 'records': records, 'new40_outcomes_read': False,
        'audit_script_sha256': sha(__file__)}))
    print(json.dumps({'artifacts': outputs, 'summary': summary, 'new40_outcomes_read': False}))


if __name__ == '__main__':
    main()
