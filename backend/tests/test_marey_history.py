from types import SimpleNamespace

from app.core.marey_history import capture_marey_history_snapshot


def test_capture_appends_in_place_and_replaces_duplicate_step():
    session = SimpleNamespace(
        env=SimpleNamespace(_elapsed_steps=3, agents=[]),
        marey_history_snapshots=[],
    )
    history = session.marey_history_snapshots

    capture_marey_history_snapshot(session)
    session.env._elapsed_steps = 4
    capture_marey_history_snapshot(session)

    assert session.marey_history_snapshots is history
    assert [snapshot["step"] for snapshot in history] == [3, 4]

    capture_marey_history_snapshot(session)

    assert session.marey_history_snapshots is history
    assert [snapshot["step"] for snapshot in history] == [3, 4]
