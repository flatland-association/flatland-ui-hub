# Widget `kind` picker — data for the visual decision aid

Use this data to render a visual kind-picker (inline if your tool can, e.g. `mcp__visualize__show_widget`)
(one card per kind, in this order, coloured with the badge token). If the
visualize tool is unavailable, present the table as text.

The badge colours are the **exact same tokens** the app uses
(`frontend/src/styles.scss` `--app-kind-*`) so the picker matches the Widget Gallery.

| Kind | Badge token | Fallback hex | AI-novel | Answers | Examples today |
|------|-------------|--------------|:--------:|---------|----------------|
| **Event** | `--app-kind-event` | `#eb0000` (red) | | *What is happening?* | Situation Summary, Notifications |
| **Context** | `--app-kind-context` | `#444444` (iron) | | *Why, how bad, whom does it affect?* | Trains, Agent Inspector, Impact |
| **Prediction** | `--app-kind-prediction` | `#762c8f` (violet) | ⭐ | *What happens next / what-if?* | Graphic Timetable; B1 what-if, B2 conflict-Marey |
| **Decision Support** | `--app-kind-decision-support` | `#0079c7` (blue) | ⭐ | *Which option, on what evidence?* | Scenario, Recommendations; C1 trade-off frontier |
| **Control** | `--app-kind-control` | `#212121` (charcoal) | | *Enact / adjust.* | Toolbar, KPI Filter, Director Directive; D1 autonomy dial |
| **Capitalization** | `--app-kind-capitalization` | `#00973b` (green) | ⭐ | *What do we learn from this?* | Decision Log, Co-Learning Reflection |
| **Trust** | `--app-kind-trust` | `#ffaa00` (orange) | ⭐ | *Can I rely on the AI here?* | Risk & Uncertainty; A3 track record, D2 non-control zones |

⭐ = **AI-novel core capability** — the project's centre of gravity. Prefer these
when the widget's whole point is an AI teaming behaviour.

## Choosing between neighbours

- **Event vs Context** — Event *detects* ("a malfunction occurred"); Context
  *explains and scopes* ("it blocks these 4 trains, ETA 12 steps, here's why").
- **Prediction vs Context** — Prediction is about the *future* (forecast /
  what-if); Context is about the *present* situation.
- **Decision Support vs Control** — Decision Support presents options + evidence
  (advisory, stays advisory under Human-in-Control); Control *enacts* a choice.
- **Trust vs Decision Support** — Trust answers *"should I rely on this?"*
  (reliability, calibration, appropriateness of reliance), not *"which option?"*.
- **Capitalization** is the loop's learning stage — reflection, feedback,
  decision record. If the widget's value is *after* or *across* decisions, it's here.

## Decision Support is framed by mode (not a peer kind)

A Decision Support widget shows the **same surface framed differently**:
- **Co-Learning** → **Assessment**: neutral evidence for/against, no single winner.
- **Recommendation** → **Recommendation**: ranked + confidence.
- **Director** → suppressed / read-only (the AI acts).

So a Decision Support widget's `perMode` fields must state these three framings
explicitly. `Recommendation` is a *framing*, not its own kind.

## Suggested widget

A 7-card grid (or 2 rows), each card:
- header bar in the kind's badge colour, kind name in white;
- the *"answers"* question in italic;
- an ⭐ chip if AI-novel;
- one line of examples.
Make cards clickable via `sendPrompt("I want a <kind> widget")` so the user can pick
by clicking.
