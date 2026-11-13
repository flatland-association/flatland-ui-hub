"""Freeze C3 inputs using manifests only; never read policy outcomes."""
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
import random
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SEED = 202611131850
ORDER = ('uc2-4', 'tutorial')
ALL = ('uc2-1', 'uc2-2', 'uc2-3', 'uc2-4', 'tutorial')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def key(case):
    return case['preset'], tuple(case.get('departure_offsets') or (0,) * (2 if case['preset'] == 'tutorial' else 3))


def case(preset, offsets, prefix):
    return {'preset': preset, 'seed': 0, 'departure_offsets': list(offsets),
            'disturbance_ids': [], 'disturbances': [], 'horizon': None,
            'case_id': f'{prefix}-{preset}-offsets-' + ''.join(map(str, offsets))}


def publish(relative, data):
    path = HERE / relative
    assert not path.exists(), 'Never overwrite frozen inputs'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')
    return {'manifest': relative, 'sha256': digest(path), 'cases': len(data['cases'])}


def main():
    stamp = datetime.now(timezone.utc).isoformat()
    inputs = [
        'docs/examples/uc2-rl/inputs/train105-cases.json',
        'docs/examples/uc2-roam-performance/inputs/known209-development-cases.json',
        'docs/examples/uc2-roam-performance/inputs/confirmation100-v2-cases.json',
        'docs/examples/uc2-roam-performance/inputs/dense-v2-uc2-1-train-cases.json',
        'docs/examples/uc2-roam-performance/inputs/dense-v2-uc2-2-train-cases.json',
    ]
    excluded = set()
    for relative in inputs:
        excluded.update(key(c) for c in read(ROOT / relative)['cases'])
    assert len(excluded) == 925
    expected_counts = {'uc2-1': 343, 'uc2-2': 343, 'uc2-3': 85, 'uc2-4': 85, 'tutorial': 69}
    assert {p: sum(q == p for q, _ in excluded) for p in ALL} == expected_counts
    rng = random.Random(SEED)
    cases = []
    per_preset = {}
    for preset in ORDER:
        arity, limit = (2, 10) if preset == 'tutorial' else (3, 7)
        available = [v for v in itertools.product(range(limit), repeat=arity) if (preset, v) not in excluded]
        assert len(available) == (31 if preset == 'tutorial' else 258)
        selected = rng.sample(available, 20)
        cases.extend(case(preset, vector, 'uc2-roam-confirmation-v3') for vector in selected)
        per_preset[preset] = {'trains_per_case': arity, 'coordinate_range': [0, limit-1],
            'prior_unique_physical_inputs': expected_counts[preset], 'available_before_sampling': len(available),
            'sampled': 20, 'required_dense_training_count_after_exclusion': limit**arity-20}
    fresh_keys = {key(c) for c in cases}
    assert len(cases) == len(fresh_keys) == 40 and not fresh_keys & excluded
    fresh = publish('inputs/confirmation40-v3-cases.json', {
        'schema': 'uc2-roam-confirmation-v3-cases-v1', 'split': 'test', 'created_at_utc': stamp,
        'sampling_seed': SEED, 'scope': 'Only newly tuned UC2-4 and Tutorial have unused in-domain inputs. Twenty independently sampled per map; no fake balanced new100.',
        'cases': cases})
    exhaustive = [case(preset, vector, 'uc2-roam-systematic1472-v3') for preset in ALL
        for vector in itertools.product(range(10 if preset == 'tutorial' else 7), repeat=2 if preset == 'tutorial' else 3)]
    assert len(exhaustive) == len({key(c) for c in exhaustive}) == 1472
    entire = publish('inputs/systematic1472-v3-cases.json', {
        'schema': 'uc2-roam-systematic-finite-domain-v3', 'split': 'validation', 'created_at_utc': stamp,
        'scope': 'Exhaustive declared finite domain including seen TRAIN, development and reserved confirmation inputs. NOT 1472 blind tests. Evaluate only after C3 source/model freeze.',
        'domain_formula': '4 * 7^3 + 10^2 = 1472', 'native_seed': 0,
        'cases': exhaustive})
    uc23 = [case('uc2-3', vector, 'uc2-roam-uc23-systematic-v3') for vector in itertools.product(range(7), repeat=3)]
    unchanged = publish('inputs/uc23-systematic343-v3-cases.json', {
        'schema': 'uc2-roam-unchanged-uc23-systematic-v3', 'split': 'validation', 'created_at_utc': stamp,
        'scope': 'All 343 UC2-3 offset triples 0..6. Original actor and ROAM remain frozen; may run before C3 fit, with no overlap with new40 reserved maps.',
        'cases': uc23})
    protocol = {
        'schema': 'uc2-roam-confirmation-v3-protocol-v1', 'created_at_utc': stamp,
        'manifest': fresh['manifest'], 'manifest_sha256': fresh['sha256'],
        'generator': Path(__file__).name, 'generator_sha256': digest(__file__),
        'sampling_seed': SEED, 'fixture_order': list(ORDER), 'cases': 40, 'trains': 100,
        'per_fixture': per_preset,
        'algorithm': 'One random.Random(seed), rng.sample20 from each lexicographic product after physical-input exclusions, sequential UC2-4 then Tutorial.',
        'operational_key': ['preset', 'departure_offsets_empty_means_all_zero'],
        'excluded_manifest_sha256': {relative: digest(ROOT / relative) for relative in inputs},
        'excluded_union_unique_cases': len(excluded), 'excluded_by_preset': expected_counts,
        'new_overlap_with_excluded_union': 0, 'new_internal_duplicates': 0,
        'fixture_sha256': read(HERE / 'confirmation100-v2-protocol.json')['fixture_sha256'],
        'policy_outcomes_used_for_sampling': False, 'confirmation_outcomes_opened': False,
        'training_or_rollouts_started_by_generator': False,
        'native_horizons_fault_schedules_speeds_preserved': True,
        'source_commit_at_input_freeze': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'reference_bundle_sha256_at_input_freeze': digest(ROOT / 'backend/app/policies/learned/checkpoints/uc2_roam_specialists.json'),
        'reference_identity_is_not_the_final_candidate_lock': True,
        'training_exclusion_requirement': 'Exclude the reserved20 UC2-4 triples from its dense323 train set and the reserved20 Tutorial pairs from its dense80 train set. No outcomes of these40 until separate final candidate source/model/parameter lock.',
        'systematic_domain': {**entire, 'trains': 4316, 'formula': 'UC2-1..4: all 343 triples0..6 each; Tutorial all100 pairs0..9', 'includes_seen_training_cases': True, 'is_blind_generalization_evidence': False},
        'unchanged_uc23_early_regression': unchanged,
        'previous_confirmation_status': 'Candidate1 fresh84 and Candidate2 fresh100 failed their per-case lateness gates and retain original immutable evidence. Opened outcomes may now inform Candidate3 development.',
        'limits': 'A complete finite-domain test on the same five deterministic native fixtures. No new-map, broader speed/fault schedule, or universal guarantee. Report lateness and makespan separately.',
    }
    path = HERE / 'confirmation40-v3-protocol.json'
    assert not path.exists()
    path.write_text(json.dumps(protocol, indent=2) + '\n')
    print(json.dumps({'new_confirmation': fresh, 'protocol': path.name, 'protocol_sha256': digest(path),
                      'all_domain': entire, 'unchanged_uc23': unchanged,
                      'outcomes_read': False, 'new_overlap': 0}))


if __name__ == '__main__':
    main()
