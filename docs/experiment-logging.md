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
| a tour or condition definition | `studyLogging: true` (or `false`) on its `Tour` / `StudyCondition` entry; the toggle then shows the value, disabled, with "Set by this experiment." | the setting |

```ts
// frontend/src/app/core/demo/study-conditions.ts
{ id: 'plan-b-p03', layoutId: 'preset-plan-b', mode: 'co-learning', label: 'Plan B · participant 03',
  studyLogging: true, legs: [ … ] }
```

A definition with `studyLogging: true` turns the streams on even where the
setting is off: they stay in the participant's own browser. The server parts
are switched only at server start.

**"Off" still records** the small parts of the session record, as before:
the header, decisions, context events and questionnaire answers.

## Session export

- **Footer, "Sitzungsdaten exportieren"**: the current backend session,
  with its streams, as one gzipped file, e.g.
  `flatland-anon-plan-b-p03-2-a1b2c3d4.json.gz`. In a guided experiment that
  is the current leg.
- **Start screen, "download all"**: every session saved in this browser, as
  one gzipped bundle (`records: [...]`), each record with its streams.
- **Guided experiment**: at its end the run file
  (`flatland-<condition>-<run>.json.gz`) is downloaded automatically, with
  every leg's record and streams. A leg cut off by a reload and resumed on a
  new session is in it too, under `interrupted`.
- **Delete all** on the start screen also deletes the streams.

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
