"""End-to-end frozen-network checks against independently diagnosed failures."""
import pytest

from app.policies.learned.uc2_bundle import CHECKPOINT, CHECKPOINT_SHA256
from lab.marl.evaluate_uc2_roam import digest, run_case
from lab.marl.pf_ch_episode import PFChCase

pytestmark = pytest.mark.integration


@pytest.mark.parametrize('offsets,before_arrivals,after_finish,after_lateness', [
    ((5, 0, 4), 1, 119, 52),
    ((6, 5, 1), 0, 95, 19),
])
def test_roam_intersection_repairs_head_on_without_retraining_or_planner(
        offsets, before_arrivals, after_finish, after_lateness, monkeypatch):
    import lab.marl.evaluate_pf_ch as original_evaluator

    def no_planner(*args, **kwargs):
        raise AssertionError('ROAM comparison must never use a planner fallback')

    monkeypatch.setattr(original_evaluator, 'create_teacher', no_planner)
    case = PFChCase('uc2-1', departure_offsets=offsets)
    before = run_case(case, 'v0', CHECKPOINT)
    assert before['arrived'] == before_arrivals
    assert before['complete_mission'] is False
    assert before['endpoint_stuck']
    for variant in ('v1', 'v2'):
        after = run_case(case, variant, CHECKPOINT)
        assert after['complete_mission'] is True
        assert after['arrived'] == after['total'] == 3
        assert after['steps'] == after_finish
        assert after['lateness'] == after_lateness
        assert after['endpoint_stuck'] == []
        assert after['reference_disagreements'] == after['new_stuck_steps'] == 0
        assert after['prediction_mismatches'] == after['resource_conflicts'] == 0
        assert after['planner_interventions'] == 0
        assert after['mask_action_changes'] > 0
    assert digest(CHECKPOINT) == CHECKPOINT_SHA256
