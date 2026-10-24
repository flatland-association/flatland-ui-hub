"""The planner weights have to be where the container puts them.

`/director/strategies` is gated on `loaded_models()`: without the checkpoints it
answers `available: false, "No models installed — strategy plans need them"` and
every strategy comes back with `plan: None`. The trains still drive, because the
policy has a model-free fallback, so the screen looks alive and only the A/B/C
tiles stay empty — which is how this went unnoticed on the Hugging Face Space,
whose image copied `backend/app` and nothing else.

These tests pin the two things the `COPY` lines in `Dockerfile` and
`deploy/hf/Dockerfile` rely on. They do not prove the image is right — that needs
a build, which CI does not do — but they fail if the assumption moves.
"""

from pathlib import Path

from app.policies.goal_directed_policy import (
    DEFAULT_CONNECTION_MODEL,
    DEFAULT_EVALUATOR,
)

BACKEND = Path(__file__).resolve().parents[1]


def test_the_checkpoints_are_in_the_repo():
    """Plain files under backend/models, not fetched at build time."""
    for path in (Path(DEFAULT_EVALUATOR), Path(DEFAULT_CONNECTION_MODEL)):
        assert path.is_file(), f"missing: {path}"
        # A Git LFS pointer is ~130 bytes of text; the real checkpoints are MB.
        assert path.stat().st_size > 100_000, f"looks like a pointer, not weights: {path}"


def test_the_models_dir_sits_beside_the_app_package():
    """What the Dockerfiles encode: `backend/app` → /app/app and
    `backend/models` → /app/models, because the policy resolves the weights from
    its own third parent. Move the models under `app/` and both COPY lines are
    wrong while the local checkout keeps working."""
    models = Path(DEFAULT_EVALUATOR).parent.parent
    assert models == BACKEND / "models"
    assert models.parent == (BACKEND / "app").parent


def test_the_resolution_survives_the_container_layout(tmp_path):
    """The arithmetic itself, on a tree shaped like the image rather than the
    repo: /app/app/policies/<module>.py must find /app/models/goal_directed."""
    root = tmp_path / "app"
    module = root / "app" / "policies" / "goal_directed_policy.py"
    module.parent.mkdir(parents=True)
    module.write_text("")
    (root / "models" / "goal_directed").mkdir(parents=True)

    resolved = module.resolve().parents[2] / "models" / "goal_directed"

    assert resolved == root / "models" / "goal_directed"
    assert resolved.is_dir()
