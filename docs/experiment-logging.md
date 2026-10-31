# Experiment logging: what is recorded, and how to collect it

For whoever runs a study: the facilitator, or the person who starts the
server. It says what the app records, how to switch each part on, and where
the files end up. The design and the open questions are in
[`plans/experiment-logging-frontend-and-replay.md`](plans/experiment-logging-frontend-and-replay.md)
(issue [#129](https://github.com/flatland-association/flatland-ui-hub/issues/129)).

> [!CAUTION]
> Recordings contain the participant's behaviour and free text (reflection
> notes, open questionnaire answers). Decide consent, retention and who holds
> the files before collecting data from real participants (plan §13, Q7).

## Where the files are

### Server: one folder per run, one subfolder per session

With the study sink on (`STUDY_SINK_ENABLED=1`), the server keeps a copy of
every session record. Each session sits in the folder of the run it belongs
to, so all session folders are at the same depth:

```
backend/data/study-records/
  2026-10-29_08-03-12Z_plan-b-p03_run-mh2k9q-x7f3a1/   # guided condition: <run start>_<condition id>_<run id>
    2026-10-29_08-04-00Z_a1b2c3d4/                     # leg 1: <session start>_<session id>
      record.json
    2026-10-29_08-19-00Z_e5f6a7b8/                     # leg 2
      record.json
  2026-10-29_09-10-05Z_tour-colearning-intro_run-mh2m1c-k2p9d4/   # tour: <run start>_tour-<tour id>_<run id>
    2026-10-29_09-10-10Z_f1e2d3c4/
  2026-10-29_09-30-00Z_free_c9d0e1f2/                  # free session: a run of one
    2026-10-29_09-30-00Z_c9d0e1f2/
```

- **Times are UTC**, written `2026-10-29_08-03-12Z` (no `:`, so the names
  also work on Windows). Listings sort by time.
- **Find a participant's runs** by the condition id:
  `ls -d backend/data/study-records/*_plan-b-p03_*`.
- **A free session's reset** starts a new session, so it gets its own
  `free_<sid>` folder. Legs, resets and a leg resumed after a reload of a
  guided condition or tour stay in their run's folder.
- **Older records** (`backend/data/study-records/<sid>.json`, before this
  layout) stay where they are and are still listed and read.
- **Removing old data:** the app never deletes folders. They start with the
  time, so remove them by name, e.g. everything before `2026-10-01`.

## Code version

Every session record names the code it ran on, in `header.appVersion`: the
short git commit read from `/build-info.json`.

- **`./start-demo.sh` stamps the build** when it builds the frontend
  (first start, or `./start-demo.sh 8000 "" --rebuild`): commit, branch and
  build time go into the served `build-info.json`.
- **`-dirty`** (e.g. `45906a8-dirty`) means the checkout had uncommitted
  changes, so the commit alone does not describe the code. `start-demo.sh`
  prints a warning, and the start screen's Experiments door shows a note.
- **`dev`** means the build was never stamped (`npm run start`, or a
  `start-demo.sh` build older than this feature). The start screen shows the
  same note.
- For a study, run a clean, committed checkout and rebuild once:
  `git status` shows nothing, then `./start-demo.sh 8000 "" --rebuild`.

## Switching logging on

The browser records three high-volume streams: **backend calls**, **clicks**
and **train movements**. They are written only while **"Study logging"** is
on. Off is the default.

| Where | How | Wins over |
|---|---|---|
| Session Settings → Basic → "Study logging" | the participant's or facilitator's choice, remembered in this browser | the default (off) |
| the deployment, `frontend/public/ui-config.json` | `"studyLogging": false` (or `true`); the toggle then shows the value, disabled, with "Set for this installation." | the setting |
| a tour or condition definition | `studyLogging: true` (or `false`) on its `Tour` / `StudyCondition` entry; the toggle then shows the value, disabled, with "Set by this experiment." | the deployment and the setting |

```ts
// frontend/src/app/core/demo/study-conditions.ts
{ id: 'plan-b-p03', layoutId: 'preset-plan-b', mode: 'co-learning', label: 'Plan B · participant 03',
  studyLogging: true, legs: [ … ] }
```

A definition with `studyLogging: true` turns the streams on even where the
setting or the deployment is off: they stay in the participant's own
browser. The server parts are switched only at server start.

The deployment value goes in `ui-config.json`, the file that also hides UI
items (`docs/plans/configurable-ui-plan.md`). It is read once at startup.
`control.studyLogging` under `hidden` removes the toggle from Session
Settings altogether; the value still applies.

```jsonc
// Public installation (e.g. the Hugging Face Space): never record, no toggle.
{ "$schema": "/ui-config.schema.json", "studyLogging": false, "hidden": ["control.studyLogging"] }

// Lab machine: always record; the toggle stays visible, locked, as a reminder.
{ "$schema": "/ui-config.schema.json", "studyLogging": true }
```

To use one: `UI_CONFIG=lab.json ./start-demo.sh` (it replaces the shipped,
empty file, no rebuild). In the Docker image the file is
`/app/static/ui-config.json`; mount your own over it.

**"Off" still records** the small parts of the session record, as before:
the header, decisions, context events and questionnaire answers.

## Session export

- **Footer, "Sitzungsdaten exportieren"**: the current backend session,
  with its streams, as one gzipped file, e.g.
  `flatland-anon-plan-b-p03-2-a1b2c3d4.json.gz`. In a guided experiment that
  is the current leg.
- **Start screen, saved runs, "Download data"**: the selected runs'
  sessions, as one gzipped bundle (`records: [...]`), each record with its
  streams (see "Saved runs").
- **Guided experiment**: at its end the run file
  (`flatland-<condition>-<run>.json.gz`) is downloaded automatically, with
  every leg's record and streams. A leg cut off by a reload and resumed on a
  new session is in it too, under `interrupted`.
- **Delete selected** in the saved runs also deletes the streams.

The files are the same JSON as before, gzipped (record version 3). Unpack:

```bash
gunzip -k flatland-anon-plan-b-p03-2-a1b2c3d4.json.gz
```

```python
import gzip, json
record = json.load(gzip.open("flatland-anon-plan-b-p03-2-a1b2c3d4.json.gz", "rt"))
len(record.get("clicks", []))
```

**Where the streams live until export:** in the browser's IndexedDB
(`flatland_study_streams`), written through about every second, so a crash
loses at most the last second. A private window or a full disk stops them:
the footer then shows **"Logging incomplete"**. Export at once, then free
space (delete exported sessions) or leave the private window.

## Workflow transitions

**What is logged:** which screen the participant sees, from the moment a
session exists. Each change is one `view_enter` context event in the
session record; the time spent on a screen is the gap to the next one.
This is a context event, so it is recorded with "Study logging" off too.

```json
{ "seq": 14, "t": 1761725040000, "simStep": 0, "mode": "co-learning",
  "type": "view_enter",
  "payload": { "view": "session", "detail": { "centerTab": "map", "layoutId": "default" }, "from": "mode_intro" } }
```

| `view` | `detail` |
|---|---|
| `start` | – (only as the last screen of a record: the start screen itself is not logged) |
| `resume_prompt` | – |
| `experiment` | `{phase}` of a guided condition outside play (`briefing`, `legSurvey`, `review`, `finalSurvey`, `done`), with `legId` |
| `tour_opening` | `{tourId}` |
| `mode_intro` | `{tourId, leg, mode}`, with `legId` in a guided condition |
| `session` | `{centerTab, layoutId}`, plus `guideStep` while the tour guide is open |
| `reflection` | `{kind}`: `co-learning`, `rationale` or `strategy` |
| `survey` | `{legId}` in a guided condition |
| `shift_review` | `{debrief}` |
| `help` | – |
| `settings` | `{tab}` |
| `demo_complete` | `{tourId}` |
| `hidden` | – (the browser tab was hidden) |
| `page:<name>` | – (layout designer, galleries: outside experiments) |

Overlays (help, settings, a questionnaire, a reflection dialog) take
precedence; when they close, the screen below is entered again.

**Between sessions.** A record keeps receiving these events after its
session ended, until the next session starts. The questionnaire after
leg 1 is therefore in leg 1's record, after its `endedAt`. Each new record
starts with a `view_enter` for the screen already on display (e.g. the
next leg's intro), with `from: null`.

**Run and leg.** Every session of one guided condition or one tour carries
the same `header.experimentRunId`, and `header.legIndex` says which leg it
played (tours have no `legId`). A reset keeps both. Group the legs of a run:

```python
import gzip, json, pandas as pd
bundle = json.load(gzip.open("flatland-session-records-2026-10-29T10-00-00-000Z.json.gz", "rt"))
rows = [{"run": r["header"].get("experimentRunId"), "leg": r["header"].get("legIndex"),
         "t": e["t"], "view": e["payload"]["view"]}
        for r in bundle["records"] for e in r["context"] if e["type"] == "view_enter"]
views = pd.DataFrame(rows).sort_values("t")
views["seconds"] = views.groupby("run")["t"].diff(-1).abs() / 1000
views.groupby(["run", "view"])["seconds"].sum()
```

### UI state: panels and viewports

Clicks don't show what was visible: a panel collapsed by default, or a
map zoomed with the mouse wheel. So the panel collapse and the map and
Marey viewports are logged as **state**: one `ui_state` context event per
settled change (fast changes such as wheel zoom or drag-pan settle into
one event after 300 ms of quiet), and a snapshot of every key when a
session starts. Like `view_enter`, they are recorded with "Study logging"
off too. Each is small (one key, one value), and there is one per panel
opened or closed and per zoom or pan.

```json
{ "seq": 31, "t": 1761725102000, "simStep": 42, "mode": "co-learning",
  "type": "ui_state", "payload": { "key": "map.viewport", "value": { "zoom": 2.5, "panX": -120, "panY": 40 } } }
```

| `key` | `value` |
|---|---|
| `panel.<panelId>.expanded` | `true` / `false`: a layout panel's accordion (every panel, by its id in the layout) |
| `panel.<type>.collapsed` | `true` / `false`: the inner collapse of `decision-log`, `recommendations`, `recommendations-classic`, `ai-activity`, `scenario`, `kpi-filter` |
| `panel.risk-uncertainty.expanded` | `true` / `false` |
| `panel.left-sidebar.collapsed` | `{MOVING, WAITING, DONE}`: the train groups |
| `map.viewport` | `{zoom, panX, panY}` |
| `marey.viewport` | `{xRange: {start, end}, yRange: {start, end}, axesSwapped}` |

A replay sets these back, so it shows the same panels and the same map
section. On a screen of another size the map is cropped slightly
differently, because the visible area follows the screen's proportions
(`header.screen` has the original size). The mouse cursor is not logged.

## Backend calls

### Browser part

**What is logged:** every call the app makes to the backend, as the browser
saw it, in the record's `calls` stream (only while "Study logging" is on).
A response identical to the previous one of the same call (polling) is
stored as a reference, `response_same_as`, instead of again. WebSocket
connect, close, episode end and errors are entries with `method: "WS"`;
the state messages themselves are in the `states` stream.

```json
{ "seq": 1, "t": 1761725040000, "simStep": 12, "mode": "co-learning",
  "method": "POST", "url": "/session/s1/step", "body": { "n": 3 },
  "status": 200, "ms": 41, "response": { "ok": true } }
```

Translations, `ui-config.json` and the study sink's own uploads are not
logged.

**Correlation headers.** Each call carries `X-Client-Seq` (the entry's
`seq`), `X-Client-Time` and `X-Participant-Id` (the participant id, else the
condition id). The server's call log copies them into `client`, so a
browser entry and a server line can be joined, and the clock offset between
the two machines estimated. The headers are sent with logging off too; they
contain no answers.

**Privacy:** the bodies are decisions, settings and simulation state; the
app sends no questionnaire answers or free text to the backend. The
participant id is in every call's `X-Participant-Id` header.

### Server part

**What is logged:** every HTTP call the backend receives and every
WebSocket event, with request and response bodies, one JSON line each. It
is the safety net next to the browser's log: it also has calls whose
browser side was lost (a closed tab, a crashed browser).

```json
{"ts": 1761725040.12, "seq": 88, "sid": "s1", "method": "POST", "path": "/session/s1/step",
 "route": "/session/{session_id}/step", "query": {}, "body": {"n": 3}, "status": 200, "ms": 38.5,
 "response": {"ok": true}, "client": {"seq": 412, "t": 1761725040000, "participant": "P07"}}
```

A repeated identical response of the same call is written as
`"response_same_as": <seq>`. WebSocket events are lines with
`"method": "WS"` and `"event"` (`connect`, `disconnect`, `episode_done`,
`error`).

**Switching it on.** It is off unless the server starts with a logging
configuration that enables the logger `flatland.study.calls`; without it the
backend reads no bodies at all. The repository ships one,
`backend/logging.study.json`. It keeps uvicorn's normal console output.

```bash
# start-demo.sh
UVICORN_LOG_CONFIG=logging.study.json ./start-demo.sh

# uvicorn directly (from backend/)
uvicorn app.main:app --port 8000 --log-config logging.study.json

# Docker
docker run -e UVICORN_LOG_CONFIG=logging.study.json -p 8000:8000 flatland-dispatcher
```

The path is relative to `backend/`, the server's working directory.

**Where the files are.**

```
backend/data/study-records/<run folder>/<session folder>/backend-calls.jsonl   # one per session
backend/data/study-logs/sessionless/backend-calls.jsonl                       # calls without a session
```

The session file sits next to the session's `record.json` (see "Where the
files are"). Calls that belong to no session (`/policies`, the scenario
list, `/health`) go to the sessionless file.

**Retention.** Files, rotation and retention are standard Python `logging`
configuration in the same file; the app only adds one thing that
`dictConfig` cannot do: one file per session. That handler is described
under `flatland_session_handler` (a template: `{session_dir}` is replaced by
the session's folder). Change the `sessionless_file` handler, and the
template the same way:

```json
"sessionless_file": {
  "class": "logging.handlers.TimedRotatingFileHandler",
  "filename": "data/study-logs/sessionless/backend-calls.jsonl",
  "when": "midnight", "backupCount": 0, "utc": true, "encoding": "utf-8", "delay": true,
  "formatter": "line"
}
```

- **Keep everything** (shipped): `"backupCount": 0` keeps every rotated day.
- **Keep 30 days:** `"backupCount": 30`.
- **10 files of 100 MB:**
  `"class": "logging.handlers.RotatingFileHandler", "maxBytes": 104857600, "backupCount": 10`
  (drop `when` and `utc`).

Rotation in a session file only matters for a session that runs past
midnight. Old session folders are removed by name, like the records.

**Settings** (environment variables of the backend):

| Variable | Default | Meaning |
|---|---|---|
| `STUDY_CALL_LOG_EXCLUDE` | empty | route templates not to log, comma-separated, e.g. `/session/{session_id}/state` |
| `STUDY_CALL_LOG_OPEN_FILES` | `64` | session files kept open at once; the least recently used is closed first and reopened on its next call |

CORS preflight requests and the study sink's own uploads (`/study/…`) are
never logged.

**Library documentation:**
[Python `logging`](https://docs.python.org/3/library/logging.html),
[the `dictConfig` schema](https://docs.python.org/3/library/logging.config.html#logging-config-dictschema),
[handlers](https://docs.python.org/3/library/logging.handlers.html),
[logging cookbook](https://docs.python.org/3/howto/logging-cookbook.html)
(e.g. compressing rotated files),
[uvicorn logging settings](https://www.uvicorn.org/settings/#logging).

**Privacy:** the lines contain the participant id (`client.participant`) and
everything the browser sent; no questionnaire answers.

## flatland-rl trajectories

**What is logged:** every episode played in a session, as a flatland-rl
**Trajectory** in the flatland-association format: the applied actions, the
train positions, rewards and dones per step, the result at episode end, and
environment snapshots (`.pkl`) to restore any step. Two files of our own add
what the standard format has no column for: the AI's proposal next to the
applied action, and the scripted disturbances.

```
<run folder>/<session folder>/trajectory/
  meta.json                                        # session, run, scenario, seed, policy changes, versions, episodes
  event_logs/
    ActionEvents.discrete_action.tsv               # episode_id, env_time, agent_id, action
    TrainMovementEvents.trains_positions.tsv       # episode_id, env_time, agent_id, position
    TrainMovementEvents.trains_rewards_dones_infos.tsv
    TrainMovementEvents.trains_arrived.tsv         # success rate and normalised reward at episode end
    HmiEvents.action_provenance.tsv                # episode_id, env_time, agent_id, proposed_action, applied_action, source
    HmiEvents.disturbances.tsv                     # episode_id, env_time, agent_id, kind, params
  serialised_state/
    <ep_id>.pkl                                    # the env before the first recorded step
    <ep_id>_step0010.pkl                           # every 10 steps, and after each disturbance
```

`source` is `policy` (the AI's action was applied), `override` (a
dispatcher's decision at the next switch; a "hold" set by the app looks the
same here, the session record's decision log tells them apart), `reroute`
or `manual` (a single step by hand). A reset starts a new episode
(`ep_id`) in the same folder; `meta.json` lists them.

**Switching it on** (backend environment variables; never on the public
Space):

```bash
STUDY_TRAJECTORIES_ENABLED=1 ./start-demo.sh
STUDY_TRAJECTORIES_ENABLED=1 STUDY_SNAPSHOT_INTERVAL=5 uvicorn app.main:app --port 8000
docker run -e STUDY_TRAJECTORIES_ENABLED=1 -p 8000:8000 flatland-dispatcher
```

| Variable | Default | Meaning |
|---|---|---|
| `STUDY_TRAJECTORIES_ENABLED` | `0` | record trajectories |
| `STUDY_SNAPSHOT_INTERVAL` | `10` | a snapshot every N steps; `0` only the start (and after disturbances) |

The tables are written every 50 steps, at episode end, on reset and when the
session is deleted; after a server crash the rows of the last steps before
it may be missing, the snapshots are not. Sandbox and what-if simulations
are not recorded.

**Loading** with flatland-rl:

```python
import json
from pathlib import Path
from flatland.trajectories.trajectories import Trajectory
from flatland.evaluators.trajectory_evaluator import TrajectoryEvaluator

folder = Path("backend/data/study-records/<run folder>/<session folder>/trajectory")
ep_id = json.load(open(folder / "meta.json"))["episodes"][0]["ep_id"]
trajectory = Trajectory.load_existing(folder, ep_id)
trajectory.actions.head()
env = trajectory.load_env(start_step=25)       # nearest snapshot, stepped forward with the recorded actions
TrajectoryEvaluator(trajectory).evaluate()     # replays the episode and checks it against the recording
```

Library documentation: `flatland/trajectories` in
[flatland-rl](https://github.com/flatland-association/flatland-rl) and its
documentation.

**Privacy:** no personal data; the run folder name carries the condition id.

### Browser part: train movements for replay

**What is logged:** every state the backend pushes over the WebSocket, as
a frame in the record's `states` stream (only while "Study logging" is on).
The first frame of a session carries the map and every train; later frames
only the trains that changed, plus `maxSteps` and `episodeDone` when they
change. This is what the replay plays back; it needs no server files.

```json
{ "seq": 2, "t": 1761725041000, "simStep": 1,
  "agents": [{ "handle": 0, "position": [2, 1], "direction": 1, "state": "MOVING", "delay": 0, "…": "the full train as the app shows it" }] }
```

Switching "Study logging" on in the middle of a session starts again with a
full frame.

## Clicks

**What is logged:** every click from the moment a session exists (not on
the start screen), in the record's `clicks` stream, only while "Study
logging" is on. Each click names what was clicked, in which panel and on
which screen:

```json
{ "seq": 1, "t": 1761725050000, "simStep": 7, "mode": "recommendation",
  "target": "decision.hold", "panel": "decision-log", "view": "session" }
```

- **`target`** is the control's `data-log` id where it has one (a
  translation key, so the same in every language); else its `id` (`#…`);
  else the tag with its position among its siblings, e.g. `sbb-button[1]`.
- **`panel`** is the panel the click was in (`data-panel-type`); `null` in
  the default layout, which has no panels.
- **Map and Marey clicks** also say what they were about and where they
  landed, independent of zoom and window size:

  ```json
  { "target": "app-flatland-map", "panel": "flatland-map", "view": "session",
    "object": { "kind": "agent", "handle": 3 }, "at": { "row": 12, "col": 40 } }
  { "target": "app-marey-chart", "panel": "view-tabs", "view": "session",
    "object": { "kind": "pill", "handle": 1, "action": "4" }, "at": { "step": 31, "pos": 17.5 } }
  ```

  `object` is a train (`agent`), a track cell (`cell`), a station
  (`station`), a decision pill (`pill`) or a proposed course (`option`);
  the step buttons add `{"kind": "step", "n": 10}`; `at`
  is the grid cell on the map
  and the sim step and position along the line on the Marey chart.
- **Text fields:** a click into one is logged with `"field": true`; what is
  typed is never logged.
- **The browser window** at session start is in the header,
  `header.screen` (`width`, `height` in CSS pixels, `dpr`).

Hovering, scrolling and keyboard shortcuts are not logged.

### Click ids

The controls that carry a `data-log` id. An id is the translation key of
the control's label, so it is the same in every language; `<…>` is filled
in per click (e.g. `actions.2`, the action's number; the reason chip's
key; a panel header's title key such as `panels.decisionLog`, which
expands or collapses it; a centre tab's `views.map`). Other clicks are logged with the fallback `target`. The table is the
output of `node frontend/scripts/data-log-ids.mjs`; `npm run i18n:check`
fails when an id is not a translation key. Ids are not renamed between
studies: a control whose meaning changes gets a new one.

<!-- data-log-ids:start -->
| Click id (`target`) | Template |
|---|---|
| `<c.labelKey>` | `features/rationale-capture/rationale-capture.component.html` |
| `<chip.labelKey>` | `features/strategy-reflection/strategy-reflection.component.html` |
| `<i18n.panelTitleKey(panel)>` | `features/layout/components/panel-shell/panel-shell.component.html` |
| `<t.labelKey>` | `features/view-tabs/view-tabs.component.html` |
| `actions.<opt.action>` | `features/agent-inspector/agent-inspector.component.html` |
| `ca.card.apply` | `features/combined-actions/components/action-card/action-card.component.html` |
| `log.action.<opt.action>` | `features/impact-panel/impact-panel.component.html` |
| `mode.<m.id>` | `app.component.html` |
| `panels.coLearningReflection` | `features/co-learning-reflection/co-learning-reflection.component.html` |
| `proposals.keepPlan` | `features/proposal-compare/proposal-compare.component.html` |
| `proposals.takeAi` | `features/proposal-compare/proposal-compare.component.html` |
| `proposals.takeHuman` | `features/proposal-compare/proposal-compare.component.html` |
| `rationale.no` | `features/rationale-capture/rationale-capture.component.html` |
| `rationale.once` | `features/rationale-capture/rationale-capture.component.html` |
| `rationale.once` | `features/strategy-reflection/strategy-reflection.component.html` |
| `rationale.yes` | `features/rationale-capture/rationale-capture.component.html` |
| `rec.accept` | `features/recommendations-classic/recommendations-classic.component.html` |
| `rec.accept` | `features/recommendations-panel/recommendations-panel.component.html` |
| `rec.reject` | `features/recommendations-classic/recommendations-classic.component.html` |
| `rec.reject` | `features/recommendations-panel/recommendations-panel.component.html` |
| `risk.accept` | `features/risk-uncertainty/risk-uncertainty-panel.component.html` |
| `risk.override` | `features/risk-uncertainty/risk-uncertainty-panel.component.html` |
| `savedRuns.deleteSelected` | `features/saved-runs/saved-runs-list.component.html` |
| `savedRuns.download` | `features/saved-runs/saved-runs-list.component.html` |
| `savedRuns.import` | `features/saved-runs/saved-runs-list.component.html` |
| `savedRuns.questionnaires` | `features/saved-runs/saved-runs-list.component.html` |
| `savedRuns.selectAll` | `features/saved-runs/saved-runs-list.component.html` |
| `savedRuns.summary` | `features/saved-runs/saved-runs-list.component.html` |
| `strategy.apply` | `features/strategy-options/strategy-options.component.html` |
| `strategy.onMap` | `features/strategy-options/strategy-options.component.html` |
| `strategy.simTitle` | `features/strategy-options/strategy-options.component.html` |
| `strategyReflection.asRule` | `features/strategy-reflection/strategy-reflection.component.html` |
| `strategyReflection.notTrue` | `features/strategy-reflection/strategy-reflection.component.html` |
| `strategyReflection.ownReason` | `features/strategy-reflection/strategy-reflection.component.html` |
| `toolbar.pause` | `features/toolbar/toolbar.component.html` |
| `toolbar.play` | `features/toolbar/toolbar.component.html` |
| `toolbar.policy` | `features/toolbar/toolbar.component.html` |
| `toolbar.speed` | `features/toolbar/toolbar.component.html` |
| `toolbar.step` | `features/toolbar/toolbar.component.html` |
| `toolbar.step` | `features/toolbar/toolbar.component.html` |
| `toolbar.step` | `features/toolbar/toolbar.component.html` |
<!-- data-log-ids:end -->

## Questionnaires

**What is recorded:** the answers to every in-app questionnaire, in the
session record (`surveys`) and, in a guided condition, in the run file
(`questionnaires`), each with the language it was answered in (`lang`). In
a guided condition each answer set also names the leg it followed
(`afterLegId`, `null` for the final questionnaire). This is recorded with
"Study logging" off too. The questionnaires themselves are in English.

**Tables.** The saved-runs list on the start screen exports the answers as
tables (one `.xlsx` per run and one over all selected runs, see "Saved
runs"):

- **long**: one row per answer.

  ```
  condition_id,experiment_run_id,run_started_at,leg_index,leg_id,session_id,mode,survey_id,after,item_id,question,answer,scored_value,subscale,reverse,free_text,lang,submitted_at,participant_id
  plan-b-p03,run-mh2k9q-x7f3a1,2026-10-29T08:03:12.000Z,0,wal-single-track,a1b2c3d4,co-learning,post-session-co-learning,leg,und_2,The system’s predictions were confusing or unpredictable.,2,6,perceived,true,false,de,2026-10-29T08:18:40.000Z,
  ```

  `scored_value` is the answer as scored (reversed items turned round,
  e.g. 2 → 6 on 1..7); `after` is `leg` or `final`; `participant_id` is
  usually empty, since the condition id names the person.
- **wide**: one row per submitted questionnaire, one column per item (free
  text left out) and the scores as `<part>.<score>`, e.g. `nasa-tlx.raw`,
  `trust.trust`, `trust.distrust`, `ueq-s.pragmatic`, `understanding.perceived`.
  Scores are computed when exporting, with the app's own scoring.
- **codebook**: every item once: `survey_part, item_id, question, type,
  min, max, reverse, subscale, instrument, source`. `source` is the item's
  file and position in AI4REALNET `hmisurveys`, e.g.
  `trust/trust.html #7`, where the item comes from there.

**Privacy:** free-text answers (`free_text = true`, the "Open feedback"
part) can contain anything the participant typed. Remove those rows from the
long table before handing it on:

```python
import pandas as pd
long = pd.read_csv("all-runs_long.csv")
long[~long["free_text"]].to_csv("all-runs_long_no-free-text.csv", index=False)
```

## Saved runs

The start screen lists every run saved in this browser, and any imported
ones, under **"Saved runs: N"** (click to open it):

- **Grouping:** the sessions of one guided condition or tour are one run,
  each a scenario with its start time, duration and mode; a free session is
  a run of its own. Newest first.
- **Select** runs one by one or with **Select all**; a run is selected with
  all its sessions.
- **Download data**: the selected sessions with their streams, as one
  `.json.gz` (see "Session export").
- **Questionnaires (xlsx)**: one `.zip`, named after the export time,
  e.g. `2026-10-31_09-12-00Z_questionnaires.zip`, with
  - one workbook per run, named like the run's server folder,
    e.g. `2026-10-29_08-03-12Z_plan-b-p03_run-mh2k9q-x7f3a1.xlsx`
  - `all-runs.xlsx` over all selected runs
  - `all-runs_long.csv`, the long table for scripts

  Each workbook has the sheets `long`, `wide` and `codebook` (see
  "Questionnaires").
- **Delete selected** removes the selected sessions from this browser after
  a confirmation: records, streams, questionnaire answers and reflections.
  Copies on the server and the learning records stay. On a shared lab
  machine this removes one participant's data after hand-over without
  touching the others'.
- **Import files…** adds export files from other machines to the list:
  session exports, "Download data" files and guided-experiment run files,
  `.json` or `.json.gz`, several at once. They are marked "imported" and
  can be selected, downloaded and exported to xlsx with the local ones, so
  the questionnaires of several lab machines end up in one
  `all-runs.xlsx`. Imports are kept **in memory only**: nothing is written
  to this browser, and a reload clears them. A session already in the list
  is not added twice. Files that are not an export are named under the
  buttons.

**Storage:** everything listed here lives in this browser only. Download
the data before clearing the browser's site data or switching machines.
