"""Compact preprocessing preserves numeric conflicts and JSONL validation."""
import copy
import json
import math
import random
import tracemalloc
from pathlib import Path

import numpy as np
import pytest
import torch

from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA
from lab.marl import train_bc
from lab.marl.collect_pp_demonstrations import SCHEMA, load_demonstrations


def _row(value=0.0, action=2, *, size=36, schema=OBSERVATION_SCHEMA):
    return {'schema': SCHEMA, 'observation_schema': schema, 'owner': 'pp_teacher',
            'source': 'native_strict_pp', 'case_id': 'explicit-train', 'split': 'train',
            'obs': [value] * size, 'mask': [1, 0, 1, 0, 1], 'teacher_action': action,
            'applied_action': action, 'weight': 1.0, 'step': 1, 'handle': 0}


def _legacy_counts(rows):
    rounded, exact = {}, {}
    for row in rows:
        key = tuple(np.round(row['obs'], 5).tolist()) + tuple(row['mask'])
        rounded.setdefault(key, set()).add(row['teacher_action'])
        key = tuple(row['obs']) + tuple(row['mask'])
        exact.setdefault(key, set()).add(row['teacher_action'])
    return sum(len(labels) > 1 for labels in rounded.values()), sum(len(labels) > 1 for labels in exact.values())


def test_compact_conflicts_preserve_float64_precision_rounding_signed_zero_and_masks():
    values = [0.0, -0.0, 1e-320, -1e-320, 1.0, 1.0 + 2 ** -40,
              0.00000499999999, 0.00000500000001, 0.12345678901234567,
              math.nextafter(0.12345678901234567, math.inf), 1e30, -1e30,
              2 ** 53, 2 ** 53 + 1, 2 ** 53 + 2]
    rows = [_row(value, (0, 2, 4)[index % 3]) for index, value in enumerate(values)]
    rows.extend([_row(-0.0, 4), _row(1.0 + 2 ** -40, 4), _row(2 ** 53 + 1, 0)])
    alternate_mask = _row(-0.0, 4)
    alternate_mask['mask'] = [1.0, -0.0, 1.0, 1.0, 1.0]
    rows.append(alternate_mask)
    before = copy.deepcopy(rows)
    torch_rng, python_rng, numpy_rng = torch.get_rng_state().clone(), random.getstate(), np.random.get_state()
    assert train_bc.observation_conflict_counts(rows) == _legacy_counts(rows)
    assert rows == before
    assert torch.equal(torch_rng, torch.get_rng_state())
    assert random.getstate() == python_rng
    after_numpy = np.random.get_state()
    assert numpy_rng[0] == after_numpy[0] and np.array_equal(numpy_rng[1], after_numpy[1])
    assert numpy_rng[2:] == after_numpy[2:]


def test_compact_conflicts_match_legacy_on_randomized_repeated_labels():
    rng = np.random.default_rng(1729)
    rows = []
    for _ in range(100):
        row = _row()
        row['obs'] = rng.normal(size=36).tolist()
        rows.append(row)
        for action in (0, 2, 4):
            duplicate = copy.deepcopy(row)
            duplicate['teacher_action'] = action
            duplicate['obs'][0] += float(rng.uniform(-1e-8, 1e-8))
            rows.append(duplicate)
    assert train_bc.observation_conflict_counts(rows) == _legacy_counts(rows)


def test_compact_conflict_preprocessing_reduces_peak_allocations():
    rows = [_row(index / 1000, size=272) for index in range(500)]
    peaks = []
    for counter in (_legacy_counts, train_bc.observation_conflict_counts):
        tracemalloc.start()
        try:
            assert counter(rows) == (0, 0)
            peaks.append(tracemalloc.get_traced_memory()[1])
        finally:
            tracemalloc.stop()
    assert peaks[1] < peaks[0] * .55


def test_jsonl_stream_preserves_order_blank_lines_crlf_and_numeric_rows(tmp_path, monkeypatch):
    first, second = _row(-0.0), _row(1.0 + 2 ** -40, 4)
    paths = [tmp_path / 'first.jsonl', tmp_path / 'second.jsonl']
    paths[0].write_bytes(('\r\n' + json.dumps(first) + '\r\n \t\r\n').encode())
    paths[1].write_text(json.dumps(second))

    def whole_file_read_forbidden(*_args, **_kwargs):
        raise AssertionError('JSONL loader must stream source lines')

    monkeypatch.setattr(Path, 'read_text', whole_file_read_forbidden)
    actual = load_demonstrations(paths)
    assert actual == [first, second]
    assert math.copysign(1, actual[0]['obs'][0]) == -1
    assert actual[1]['obs'][0] != float(np.float32(actual[1]['obs'][0]))


@pytest.mark.parametrize('change,diagnostic', [
    ({'source': 'not-pp'}, 'invalid teacher provenance or split'),
    ({'split': 'test'}, 'invalid teacher provenance or split'),
    ({'observation_schema': 'unknown'}, 'unsupported demonstration observation schema'),
    ({'teacher_action': 1, 'applied_action': 1}, 'malformed or masked teacher sample'),
])
def test_jsonl_stream_preserves_validation_line_diagnostics(tmp_path, change, diagnostic):
    path = tmp_path / 'teacher.jsonl'
    invalid = {**_row(), **change}
    path.write_text(json.dumps(_row()) + '\n\n' + json.dumps(invalid) + '\n')
    with pytest.raises(ValueError, match=f'{path}:3: {diagnostic}'):
        load_demonstrations([path])


def test_compact_conflicts_leave_training_tensors_metadata_and_rng_unchanged(tmp_path, monkeypatch):
    monkeypatch.setenv('MARL_LAB_CHECKPOINTS_DIR', str(tmp_path / 'models'))
    dataset = tmp_path / 'teacher.jsonl'
    rows = [_row(0.0), _row(-0.0, 4), _row(1e-7, 0), _row(0.25, 2)]
    dataset.write_text(''.join(json.dumps(row) + '\n' for row in rows))
    args = ['--dataset', str(dataset), '--epochs', '2', '--minibatch', '2', '--device', 'cpu', '--seed', '17']
    compact = train_bc.train(['--name', 'compact', *args])
    compact_rng = torch.get_rng_state().clone()
    monkeypatch.setattr(train_bc, 'observation_conflict_counts', _legacy_counts)
    legacy = train_bc.train(['--name', 'legacy', *args])
    assert torch.equal(compact_rng, torch.get_rng_state())
    assert compact['meta'] == legacy['meta']
    first = torch.load(compact['checkpoint'], map_location='cpu', weights_only=True)
    second = torch.load(legacy['checkpoint'], map_location='cpu', weights_only=True)
    assert all(torch.equal(value, second['model'][name]) for name, value in first['model'].items())
