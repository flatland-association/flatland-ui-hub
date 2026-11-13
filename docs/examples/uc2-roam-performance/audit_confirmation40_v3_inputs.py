"""Input-only audit; never read C3 model outcomes or run any policy."""
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
import random

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EXPECTED = '193d9d63a235261a70fd0cb0a9b1e2fab6a5967239c267fd6cfec19f364ac1b1'
PROTOCOL = '3aa8d0f77af4cf62cac675a4fd504cc9fd630c7e489dfe971fe582804edc6222'


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def key(c):
    return c['preset'], tuple(c.get('departure_offsets') or (0,) * (2 if c['preset'] == 'tutorial' else 3))


def native(c):
    assert c.get('seed', 0) == 0 and c.get('horizon') is None
    assert not c.get('disturbances') and not c.get('disturbance_ids')


def main():
    protocol_path = HERE / 'confirmation40-v3-protocol.json'
    assert sha(protocol_path) == PROTOCOL
    p = read(protocol_path)
    manifest_path = HERE / p['manifest']
    assert sha(manifest_path) == p['manifest_sha256'] == EXPECTED
    assert sha(HERE / p['generator']) == p['generator_sha256']
    cases = read(manifest_path)['cases']
    actual = {key(c) for c in cases}
    assert len(cases) == len(actual) == len({c['case_id'] for c in cases}) == 40
    old = set()
    for rel, digest in p['excluded_manifest_sha256'].items():
        assert sha(ROOT / rel) == digest
        old.update(key(c) for c in read(ROOT / rel)['cases'])
    assert len(old) == 925 and not actual & old
    rng = random.Random(p['sampling_seed'])
    reconstructed = []
    for preset in p['fixture_order']:
        arity, limit = (2, 10) if preset == 'tutorial' else (3, 7)
        available = [v for v in itertools.product(range(limit), repeat=arity) if (preset, v) not in old]
        reconstructed.extend((preset, v) for v in rng.sample(available, 20))
    assert [key(c) for c in cases] == reconstructed
    for c in cases:
        native(c)
    fixture_checks = 0
    for rel, digest in p['fixture_sha256'].items():
        assert sha(ROOT / rel) == digest
        fixture_checks += 1
    domain = p['systematic_domain']
    domain_path = HERE / domain['manifest']
    assert sha(domain_path) == domain['sha256']
    grid = read(domain_path)['cases']
    expected = {(preset, vector) for preset in ('uc2-1', 'uc2-2', 'uc2-3', 'uc2-4', 'tutorial')
        for vector in itertools.product(range(10 if preset == 'tutorial' else 7), repeat=2 if preset == 'tutorial' else 3)}
    assert len(grid) == len({key(c) for c in grid}) == len({c['case_id'] for c in grid}) == 1472
    assert {key(c) for c in grid} == expected and actual <= expected
    for c in grid:
        native(c)
    uc23 = p['unchanged_uc23_early_regression']
    uc23_path = HERE / uc23['manifest']
    assert sha(uc23_path) == uc23['sha256']
    subset = read(uc23_path)['cases']
    assert len(subset) == len({key(c) for c in subset}) == 343
    assert {key(c) for c in subset} == {k for k in expected if k[0] == 'uc2-3'}
    assert not actual & {key(c) for c in subset}
    out = HERE / 'confirmation40-v3-input-audit.json'
    assert not out.exists()
    data = {'schema': 'uc2-candidate3-input-only-audit-v1', 'audited_at_utc': datetime.now(timezone.utc).isoformat(),
        'new40_manifest_sha256': EXPECTED, 'new40_protocol_sha256': PROTOCOL,
        'new40_cases': 40, 'new40_prior925_overlap': 0, 'new40_internal_duplicates': 0,
        'sampling_reproduced_exactly': True, 'source_fixture_file_hashes_verified': fixture_checks,
        'systematic1472_manifest_sha256': sha(domain_path), 'systematic1472_matches_exact_finite_domain': True,
        'systematic1472_trains': 4316, 'systematic1472_is_blind': False,
        'unchanged_uc23_manifest_sha256': sha(uc23_path), 'unchanged_uc23_cases': 343,
        'unchanged_uc23_overlap_new40': 0, 'new40_outcomes_read': False,
        'prior_failed_confirmations_preserved': ['confirmation84-independent-audit.json', 'confirmation100-v2-independent-audit.json'],
        'audit_script_sha256': sha(__file__)}
    out.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps({'artifact': out.name, 'sha256': sha(out), 'new40_outcomes_read': False}))


if __name__ == '__main__':
    main()
