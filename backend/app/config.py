from pydantic import ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = ConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    log_level: str = "info"
    cors_origins: str = "http://localhost:4200"

    # ── Encoder caps (goal_based_policies/dataset.py) ─────────────────────
    # The graph and schedule tensors the Director's value function is fed. The
    # defaults are the trained shape and should be left alone unless you know
    # why you are changing them.
    #
    # They are a *validation* guard, not an architecture limit: the graph
    # encoder reads its node count from the tensor shape and aggregates with
    # `index_add_` (evaluator.py), so no parameter is sized per node and the
    # checkpoints keep loading at any value. What the caps protect is the
    # distribution — the training layout pool measured <= 55 nodes and <= 104
    # edges (see the comments in dataset.py), and the defaults are headroom over
    # that.
    #
    # Raising them is therefore cheap to do and expensive to trust. Measured on
    # `pf-ch-wn-wal-long-approach` (191 x 9, 199 nodes, i.e. 3.6x the largest
    # graph in training): every strategy plans, 25-30 s each, and a replay
    # (`/director/whatif`) has the re-plan beat continuing — 0 delay against 1,
    # 77 steps against 89. So the pipeline holds up there. Not established: that
    # the *ranking* between the three focuses is meaningful at that size. On that
    # scenario all three replay to the same outcome and its connections axis is
    # structurally flat (`connections_total: 0`, no intermediate stops), so it
    # cannot tell us either way. Treat a raised cap as a demo setting pending the
    # acceptance sweep, not as a validated planner configuration.
    # Sized to the PF-CH corridor and no wider, because every cap is a padded
    # tensor dimension that every session pays for. Measured graph sizes:
    #   guided demo (36 x 24, generated)  77 nodes, 146 edges, schedule <= 25
    #   pf-ch-wn-wal-conflict            199 nodes, 570 edges, schedule <= 10
    #   pf-ch-wn-wal-long-approach       199 nodes, 571 edges, schedule <= 40
    #   pf-ch-corridor-stops             219 nodes, 602 edges, 16 trains
    # The trained values were nodes 96 / edges 256 / trains 8 / schedule 64 /
    # connections 96.
    encoder_max_nodes: int = 224
    encoder_max_edges: int = 640
    # Raised from the trained 8 to 16 (2026-09-26) for `pf-ch-corridor-stops`,
    # the Director tour's scenario: the only one with intermediate stops, so the
    # only one where the three focuses plan differently (measured at step 31:
    # 6 / 9 / 8 rerouted trains for delay / connections / stability, where the
    # 3-train Walensee case gives one identical plan for all three). Cost on a
    # small scenario is in the noise (Walensee long approach, three strategies:
    # 12.3 s at 8, 9.1 s at 16). Same caveat as the graph caps above: a demo
    # setting pending the acceptance sweep — 16 trains is twice the trained
    # shape. The corridor itself takes ~27 s for the first plan and ~75 s for
    # the three strategy plans.
    encoder_max_trains: int = 16
    encoder_max_schedule_nodes: int = 64
    encoder_max_connections: int = 96


settings = Settings()
