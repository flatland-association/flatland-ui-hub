"""Verify every assembled PP reference row against its original native report.

Reads already completed reports only; no solver, rollout or training is run.
Private source directories are explicit CLI inputs and never published.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
HORIZONS = {'tutorial': 40, 'uc2-1': 168, 'uc2-2': 102, 'uc2-3': 240, 'uc2-4': 180}


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def key(case):
    return case['preset'], tuple(case.get('departure_offsets') or (0,) * (2 if case['preset'] == 'tutorial' else 3))


def row_fields(row):
    case = row['case']
    assert case.get('seed', 0) == 0 and case.get('horizon') is None
    assert not case.get('disturbances') and not case.get('disturbance_ids')
    assert row['horizon'] == HORIZONS[case['preset']]
    return {'preset': case['preset'], 'departure_offsets': list(key(case)[1]),
            'seed': 0, 'horizon': row['horizon'], 'complete': row['complete_mission'],
            'arrived': row['arrived'], 'total': row['total'], 'lateness': row['lateness'],
            'steps': row['steps'], 'makespan': row['steps'],
            'arrival_steps': [t['arrival_step'] for t in row['trains']],
            'observed_native_fault_increases': len(row['observed_malfunction_counter_increases']),
            'observed_malfunction_counter_increases': row['observed_malfunction_counter_increases'],
            'native_on_map_positive_counter_steps': row['native_on_map_positive_counter_steps']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dense-v2-dir', type=Path, required=True)
    parser.add_argument('--dense-v3-dir', type=Path, required=True)
    args = parser.parse_args()
    ref_path = HERE / 'pp-reference-systematic1472-v3.json'
    reference = read(ref_path)
    paths = {
        'dense_v2_uc21': args.dense_v2_dir / 'uc2-1-323-teacher.manifest.json',
        'dense_v2_uc22': args.dense_v2_dir / 'uc2-2-323-teacher.manifest.json',
        'dense_v3_uc24': args.dense_v3_dir / 'uc2-4-323-teacher.manifest.json',
        'raw_nativefix_tutorial80': args.dense_v3_dir / 'tutorial-80-nativefix-raw-pp.json',
        'systematic_uc23': HERE / 'uc23-systematic343-pp.json',
        'confirmation100_v2': HERE / 'confirmation100-v2-pp.json',
        'confirmation40_v3': HERE / 'confirmation40-v3-pp.json',
    }
    assert set(reference['sources']) == set(paths)
    indexes, checks = {}, []
    for source_id, path in paths.items():
        spec = reference['sources'][source_id]
        assert sha(path) == spec['sha256'] and path.name == spec['artifact']
        data = read(path)
        if spec['kind'] == 'teacher_executed_native_collection':
            assert data['student_hold_budget'] == 0 and not data['failed_cases']
            assert all(c['accepted'] and not c['teacher_hold_steps'] for c in data['cases'])
            rows = [c['metrics'] for c in data['cases']]
            assert all(e['on_map'] for r in rows for e in r['observed_malfunction_counter_increases'])
        else:
            rows = data['results']
            assert all(r['policy'] == 'pp-trainruns-replan' for r in rows)
        index = {key(r['case']): r for r in rows}
        assert len(index) == len(rows) == spec['episodes_in_source']
        indexes[source_id] = index
        checks.append({'source_id': source_id, 'artifact_name': path.name, 'sha256': sha(path),
                       'native_episodes': len(rows), 'selected_reference_rows': 0})
    fields_compared = 0
    for record in reference['records']:
        source_id = record['source_id']
        assert record['source_sha256'] == reference['sources'][source_id]['sha256']
        raw = indexes[source_id][(record['preset'], tuple(record['departure_offsets']))]
        assert raw['case_id'] == record['original_case_id']
        for field, expected in row_fields(raw).items():
            assert record[field] == expected, (record['case_id'], field)
            fields_compared += 1
        next(c for c in checks if c['source_id'] == source_id)['selected_reference_rows'] += 1
    for check in checks:
        assert check['selected_reference_rows'] == reference['sources'][check['source_id']]['episodes_selected']
    raw_tutorial = indexes['raw_nativefix_tutorial80']
    companion_path = args.dense_v3_dir / 'tutorial-80-nativefix-teacher.manifest.json'
    companion = read(companion_path)
    assert sha(companion_path) == reference['sources']['raw_nativefix_tutorial80']['companion_manifest_sha256']
    assert companion['student_hold_budget'] == 0 and not companion['failed_cases']
    for entry in companion['cases']:
        assert entry['accepted']
        assert row_fields(entry['metrics']) == row_fields(raw_tutorial[key(entry['case'])])
    manifest = read(HERE / 'inputs/systematic1472-v3-cases.json')
    assert sha(HERE / 'inputs/systematic1472-v3-cases.json') == reference['input_manifest_sha256']
    domain_keys = {key(c) for c in manifest['cases']}
    actual_keys = {(r['preset'], tuple(r['departure_offsets'])) for r in reference['records']}
    assert len(reference['records']) == len(actual_keys) == len(domain_keys) == 1472 and actual_keys == domain_keys
    total_lateness = sum(r['lateness'] for r in reference['records'])
    assert total_lateness == reference['lateness'] == 43599
    assert sum(r['arrived'] for r in reference['records']) == reference['arrived'] == 4316
    assert sum(r['complete'] for r in reference['records']) == reference['complete'] == 1472
    out = HERE / 'pp-reference-systematic1472-independent-audit.json'
    assert not out.exists()
    data = {'schema': 'uc2-pp-systematic1472-independent-source-audit-v1',
        'audited_at_utc': datetime.now(timezone.utc).isoformat(), 'reference_sha256': sha(ref_path),
        'cases': 1472, 'arrived': 4316, 'lateness': total_lateness,
        'source_file_sha256_verified': True, 'all1472_reference_rows_match_original_native_report': True,
        'per_row_metric_fields_compared': fields_compared, 'sources': checks,
        'tutorial_raw_pp_collection_parity_cases': len(companion['cases']),
        'tutorial_rejected_pre_nativefix_source_not_used': True,
        'collection_sources_no_student_hold_deviations': True,
        'composed_reference_not_a_new1472_solver_run': True,
        'audit_script_sha256': sha(__file__)}
    out.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps({'artifact': out.name, 'sha256': sha(out), 'compared_fields': fields_compared}))


if __name__ == '__main__':
    main()
