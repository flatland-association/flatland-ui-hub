# Workshop "Supportive AI & Co-Learning" with the Flatland UI Hub

> **Status:** Draft 2026-11-15. The four workshop conditions, the results
> script and the workshop documents exist on `explore_db` (uncommitted at the
> time of writing). Not yet done: a full dry run with several people, a load
> test of the server, and the decisions in §8.
> **Documents:** [facilitator guide](../workshop/facilitator-guide.md) ·
> [participant guide](../workshop/participant-guide.md) ·
> [experiment design canvas](../workshop/experiment-design-canvas.md).
> Slide deck (34 slides): <https://claude.ai/artifact/BijGqFYQ9fsLzhkdCFn4fC>, private until shared.

## 1. What the workshop is

A hands-on workshop of 165 minutes for researchers, practitioners, designers
and decision-makers. Participants first take part in a small experiment that
compares a supportive AI with a co-learning AI in railway dispatching. They
then see how such an experiment is measured, and design one themselves.

The workshop has two goals:

1. Participants understand supportive AI and co-learning, and leave able to
   set up a first experiment with open-source tools.
2. We collect experimental data from the participants' own runs.

| # | Part | Min | What happens |
|---|---|---|---|
| 1 | Setting the stage | 15 | Framework: supportive AI, co-learning, the three interaction modes |
| 2 | Experience | 50 | Two runs per person in the Flatland UI Hub, one per concept, each with a questionnaire; GridOps demo |
| 3 | Validate | 25 | The instruments behind the questionnaire, the room's own results, limits |
| 4 | Design | 55 | Groups design and build an experiment, then pilot it on another group |
| 5 | Share & extend | 15 | Theory only: own widgets, own algorithms, own scenarios |
| 6 | Wrap-up | 5 | Take-aways, where the material is |

The minute-by-minute run is in the facilitator guide.

## 2. The experiment in Part 2

**Question.** Does a co-learning AI (neutral options, reflection, review)
change workload, trust and understanding compared with a supportive AI that
recommends?

**Design.** Within-subject, two runs per participant, crossed over two groups:

| Group | Run 1 (incident A: breakdown in Weesen) | Run 2 (incident B: stop in the single-track section) |
|---|---|---|
| A | Supportive AI · `ws-a1-rec-weesen` | Co-Learning AI · `ws-a2-col-single-track` |
| B | Co-Learning AI · `ws-b1-col-weesen` | Supportive AI · `ws-b2-rec-single-track` |

- Both runs use the Walensee line (`pf-ch-wn-wal-long-approach`, three
  trains, seed 42). The incident differs between run 1 and run 2, so run 2 is
  not a repetition of run 1.
- Over both groups, each concept meets each incident once and each position
  once. Order and incident are balanced, as long as the groups are about the
  same size.
- Both runs open at the tempo "Normal" (one step every two seconds). At the
  default tempo the decision window of incident B lasts a few seconds, too
  short for a first-time user.

**Measures.** After each run, the same questionnaire (24 items, about
four minutes): two mode items, NASA-TLX raw, Jian trust, perceived
understanding, two open questions. From the session record: total delay,
trains arrived, the decisions and their timing, clicks and screens.

**Participant id.** Participants type a code they are handed (e.g. `A07`)
into "Participant ID". It links their two runs and carries no name.

**What the data can and cannot say.** This is a teaching experiment with a
real record, not a controlled study:

- The two concepts differ in more than the recommendation. The supportive AI
  runs in the layout `preset-recommendation-trust` (event feed, impact,
  recommendation, risk and uncertainty); the co-learning AI in
  `preset-colearning-interview` (impact as assessment only, plan / AI / human
  comparison, decision log with reflection, shift summary). The comparison is
  between two interaction concepts as built, not between two values of one
  variable.
- Participants are not dispatchers, and each concept is run once.
- The Co-Learning run is longer (reflection, shift summary), so time on task
  differs by design.

Part 3 uses exactly these limits as teaching material.

## 3. Setup in the code

### New files

| File | What it adds |
|---|---|
| `scripts/workshop_results.py` | Reads the `ws-*` session records from the study-record folder or from a server (`STUDY_ADMIN_TOKEN`), prints scores per concept, the paired difference per participant and the order effect; `--csv` and `--save` (raw records) |
| `frontend/public/ui-configs/workshop.json` | Deployment config that sets "Study logging" on for every session, for a lab machine (`UI_CONFIG=frontend/public/ui-configs/workshop.json ./start-demo.sh`). Not needed for the four conditions, which enforce logging themselves; it also records the sessions of Part 4 |
| `docs/workshop/facilitator-guide.md` | Run of show, server setup, data collection, fallbacks |
| `docs/workshop/participant-guide.md` | Instructions for participants, Parts 2 and 4 |
| `docs/workshop/experiment-design-canvas.md` | Worksheet for Part 4 |

### Modified files

| File | What changes |
|---|---|
| `frontend/src/app/core/demo/study-conditions.ts` | New legs `WS_WEESEN` and `WS_SINGLE_TRACK` (tempo level 2), the function `workshopCondition()`, the four conditions `ws-a1-rec-weesen`, `ws-a2-col-single-track`, `ws-b1-col-weesen`, `ws-b2-rec-single-track`, added to `STUDY_CONDITIONS` |
| `frontend/src/app/core/demo/tour-briefings.ts` | New briefings `workshop-recommendation` (from `walensee-recommendation-trust-en`) and `workshop-colearning` (from `co-learning-cost-benefit-en`, seven steps, debrief up to the shift summary), each with an opening page and incident-neutral text; both added to `TOUR_BRIEFINGS` |
| `frontend/src/app/core/demo/study-conditions.spec.ts` | The Schichtbilanz guard also allows the workshop's Recommendation runs to go without it; a new test pins the four ids, their modes and legs |
| `frontend/public/i18n/{en,de,fr}.json` | `tours.ws-*.name` and `.description` (four conditions), `experimentLegs.wsWeesen` and `.wsSingleTrack` ("Walensee A", "Walensee B") |
| `docs/README.md` | Index entries for this plan and the three workshop documents |

Nothing else changes: no new type, no new widget, no backend change. The
conditions use the existing guided-condition flow
([experiment-workflow.md](experiment-workflow.md)): briefing, intro card,
run, questionnaire, saved record.

The condition ids, leg ids and briefing ids are stored in the records. They
must not be renamed once data has been collected.

### Why two conditions per participant, not one

A guided condition has one mode for all its legs
([experiment-workflow.md](experiment-workflow.md) §2). Running both concepts
in one condition would need a mode and a layout per leg, which that plan
left for later. Two links per participant need no change to the flow. The
participant id links the two runs.

## 4. Links

With `<host>` as the workshop server:

| Group | Run 1 | Run 2 |
|---|---|---|
| A | `<host>/#/experiment/ws-a1-rec-weesen` | `<host>/#/experiment/ws-a2-col-single-track` |
| B | `<host>/#/experiment/ws-b1-col-weesen` | `<host>/#/experiment/ws-b2-rec-single-track` |

The link opens the start screen with the condition selected. The participant
types the code and presses "Start experiment".

## 5. Data collection

- The four conditions set `studyLogging: true`, so clicks, backend calls and
  train movements are recorded in the browser.
- With `STUDY_SINK_ENABLED=1` the server keeps a copy of every session record
  under `backend/data/study-records/`, one folder per run. Reading them over
  HTTP needs `STUDY_ADMIN_TOKEN`.
- At the end of a run the browser also downloads the run file
  (`flatland-<condition>-<run>.json.gz`). It is the backup if the server copy
  is lost.
- A Hugging Face Space loses its disk on every restart, and every push to
  `explore_db` redeploys the playground Space. So: use a Space of its own for
  the workshop, and save the records right after Part 2 and again at the end
  (`scripts/workshop_results.py <host> --save <folder>`).

Details: [experiment-logging.md](../experiment-logging.md).

## 6. Part 4: what groups can change without code

| Element | Where in the app |
|---|---|
| Interaction mode (Recommendation, Co-Learning, Director) | Start screen, "Build your own" |
| Who dispatches (human, synthetic dispatcher, human with a digital shift partner) | Start screen, "Build your own" |
| Network and scenario | Start screen, "Build your own"; overview under `#/scenarios` |
| Interface: which widgets, where | Layout presets, or an own layout in the Layout Designer (`#/designer`, with JSON export and import); all widgets under `#/widgets` |
| Questionnaire parts | Session Settings |
| The data of a run | Footer, "Export session data" |

## 7. Risks

| Risk | What to do |
|---|---|
| The server runs one worker for all sessions. With 20 to 30 people playing at once, the play loop and the forecasts share one process | Load test with as many browser tabs as participants, a week before. Run in pairs if needed. Keep a second Space ready and split the room by group |
| A push to `explore_db` redeploys the Space during the workshop and wipes the records | A Space of its own for the workshop, or no pushes that day |
| Participants start the wrong run, or forget the code | Links and code on a printed card per person; facilitators check screens during run 1 |
| A run hangs | Reload the page: the run resumes. Otherwise start again with the same code; the script counts the last answered run |
| No network in the room | `./start-demo.sh` on a facilitator laptop on the local network, or the runs as a live demo |

## 8. Open decisions

1. **Consent and retention.** What participants are told, who holds the
   files, how long, and whether the data may be published. The participant
   guide has a draft text. Needed before any data is collected.
2. **GridOps with InteractiveAI.** The workshop description names it as the
   second environment. Part 2 reserves ten minutes for a demo; who gives it
   and whether it is hands-on is open.
3. **Acceptance.** The description names trust, workload and acceptance. The
   app has instruments for workload, trust, understanding and user experience
   (UEQ-S), none for acceptance. Either Part 3 presents acceptance in theory
   only, or an acceptance scale is added to the questionnaire (to be taken
   from `AI4REALNET/hmisurveys` if it has one).
4. **Group size and number of participants.** The design assumes 12 to 30
   participants and groups of three or four in Part 4.
5. **Server.** Which Space, on which hardware, and who holds the token.
6. **Language.** The runs and all workshop material are in English. The
   start screen follows the app language.
