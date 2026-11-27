# Workshop "Supportive AI & Co-Learning": facilitator guide

For whoever runs the workshop. The design and its reasons are in
[the plan](../plans/workshop-supportive-ai-colearning.md). Participants get
the [participant guide](participant-guide.md) and, in Part 4, the
[experiment design canvas](experiment-design-canvas.md).

Slide deck (37 slides, with speaker notes): <https://claude.ai/artifact/BijGqFYQ9fsLzhkdCFn4fC>. The link is private
until its owner shares it. Slides with text in square brackets need filling in
(date, names, consent text, GridOps demo, results).

## Roles

- **Lead:** presents, keeps time.
- **Floor support** (one per about ten participants): helps at the tables
  during the runs and in Part 4.
- **Data:** saves the records and prepares the results for Part 3. Can be the
  same person as one floor support.

## Before the day

One week before:

1. Decide consent and retention (plan §8.1) and put the agreed text on the
   consent slide and in the participant guide.
2. Set up the workshop server (below) on a clean, committed checkout.
3. Run all four links end to end yourself, questionnaire included.
4. Load test: open as many browser tabs as you expect participants, start a
   run in each, and watch whether the trains still move evenly. If not, plan
   for pairs or a second server.
5. Dry run of Part 4 with one colleague: build a layout in the Layout
   Designer, start it under "Build your own", export the session data.

The day before:

1. Print one card per participant: group, participant code, the two links
   (as QR code and as short text). Codes `A01`, `A02`, … and `B01`, `B02`, …;
   alternate A and B along the tables so the groups end up the same size.
2. Print one experiment design canvas per group.
3. Check the server is up and `scripts/workshop_results.py` reads from it.

## Server

Any machine that runs `./start-demo.sh`, or a Hugging Face Space
([deploy-hugging-face-space.md](../deploy-hugging-face-space.md)).

A laptop or lab machine:

```bash
STUDY_SINK_ENABLED=1 STUDY_ADMIN_TOKEN=<a long random string> UI_CONFIG=frontend/public/ui-configs/workshop.json ./start-demo.sh 8000 "" --rebuild
```

A Space: set `STUDY_SINK_ENABLED=1` and `STUDY_ADMIN_TOKEN` as Space secrets.
Use a Space of its own. The playground Space is redeployed on every push to
`explore_db`, and a restart wipes the stored records.

Check:

```bash
curl -s <host>/study/status
```

It must answer `"sinkEnabled": true`.

## Links

| Group | Run 1 | Run 2 |
|---|---|---|
| A | `<host>/#/experiment/ws-a1-rec-weesen` | `<host>/#/experiment/ws-a2-col-single-track` |
| B | `<host>/#/experiment/ws-b1-col-weesen` | `<host>/#/experiment/ws-b2-rec-single-track` |

A link opens the start screen with the **Workshop** door open and the run
selected. Without a link, the four runs are under "Workshop" on the start
screen. They are not listed under "Experiments".

Group A starts with the supportive AI, group B with the co-learning AI.
Run 1 is the breakdown in Weesen for everyone, run 2 the stop inside the
single-track section.

## Run of show (165 minutes)

Plan a break of ten minutes after Part 3. It is not in the 165 minutes.

### Part 1 · Setting the stage (0:00 to 0:15)

| Min | What | Slides |
|---|---|---|
| 0 to 2 | Welcome, goals, agenda | 1 to 3 |
| 2 to 6 | The AI4REALNET concept: the most effective human-AI team. The control loop. The three control modes | 4 to 6 |
| 6 to 9 | Why a recommendation alone is not enough: the four challenges and joint decision-making | 7 |
| 9 to 13 | Co-learning: adaptation in both directions. From Kolb's learning phases to functions on the screen | 8 to 9 |
| 13 to 15 | The two domains and environments. What you will do today | 10 to 11 |

The theory slides follow the project's deliverables: D3.1 (chapters 1, 2 and
6) for the concept, the control modes and co-learning, D4.1 for the
evaluation objectives in Part 3. Each slide names its source in the footer.

Eight slides in thirteen minutes is tight. If time is short, skip the control
loop (slide 5) and the Kolb table (slide 9); the speaker notes of the other
slides carry the argument without them.

Do not explain the hypotheses of the experiment yet. Participants should
meet both concepts without knowing what we expect.

### Part 2 · Experience (0:15 to 1:05)

| Min | What | Slides |
|---|---|---|
| 15 to 20 | Consent slide. Hand out the cards. Everyone opens link 1, types the code into "Participant ID". Do not start yet | 12 to 13 |
| 20 to 35 | **Run 1.** "Start experiment", read the two pages, run, questionnaire. Floor support checks that every screen shows the right run | 14 |
| 35 to 50 | **Run 2**, with link 2 and the same code | 14 |
| 50 to 60 | GridOps with InteractiveAI: the same ideas in power grid operation (demo) | 15 |
| 60 to 65 | In pairs: what differed between the two AIs? Two or three voices in the room | 16 |

What to say before run 1:

- You dispatch three trains. A disruption will occur. Keep the delay small.
- A guide strip at the top says what to do next.
- The simulation waits when the system needs your decision. If it stays
  paused after your decision, press "Play".
- When the trains have arrived, or after about eight minutes, finish the
  scenario with the button at the top right and answer the questionnaire.
- Work alone and do not compare screens: your neighbour has the other AI.

What goes wrong, and what to do:

| Problem | Fix |
|---|---|
| The start screen shows another run, or no door is open | Open the link again in a new tab, or choose "Workshop" on the start screen and pick the run by its name (e.g. "Workshop A1") |
| No code typed | It can be typed before run 2; note the session's start time and tell the data person |
| The page hangs | Reload. The run resumes. If not, start again with the same code |
| Somebody is done early | They wait for the room; run 2 starts together |
| Somebody does not want their data used | They type `no-data` as participant ID. Those records are deleted afterwards |

While the room does run 2, the data person saves the records of run 1:

```bash
STUDY_ADMIN_TOKEN=<token> python scripts/workshop_results.py <host> --save workshop-backup
```

### Part 3 · Validate (1:05 to 1:30)

During the GridOps demo, run the script again and copy the table into the
results slide.

| Min | What | Slides |
|---|---|---|
| 65 to 72 | Why validated instruments, and the project's evaluation objectives (D4.1). What you just answered: NASA-TLX, trust in automation, understanding | 17 to 22 |
| 72 to 75 | What else was recorded: decisions, timing, delay, clicks | 23 |
| 75 to 85 | The room's results. First ask: what do you expect? Then show the table | 24 |
| 85 to 90 | What this experiment cannot show: small sample, novices, two layouts, one run each | 25 |

Questions for the discussion:

- Which AI did you trust more, and what on the screen made you do so?
- Did the reflection in the Co-Learning run cost effort, and was it worth it?
- Which of the two would you want after a year on the job, not after ten
  minutes?

### Break (10 minutes)

### Part 4 · Design (1:30 to 2:25)

| Min | What | Slides |
|---|---|---|
| 90 to 95 | From participant to designer. The canvas. What can be changed without code | 26 to 29 |
| 95 to 125 | Groups of three or four fill in the canvas and build their experiment | 30 |
| 125 to 135 | Pilot: one person of the neighbouring group runs it, the designers watch and take notes | 31 |
| 135 to 145 | Three groups show theirs in two minutes each: question, what they changed, what the pilot showed | 31 |

Steer the groups towards one question and one change. A group that changes
mode, layout and scenario at once has nothing to compare.

Starting points to offer a group that is stuck:

- Does the "Risk & Uncertainty" widget change how often people follow the
  recommendation? Same layout, with and without the widget.
- Does a time-distance diagram help novices to see a conflict earlier than
  the track map alone?
- Supervising instead of deciding: the same incident in Director mode.
- Human alone against human with a digital shift partner.

Ask each group to export its layout (Layout Designer, "Export JSON") and one
session ("Export session data") and to hand in the canvas. Collect them: they
are data too.

### Part 5 · Share & extend (2:25 to 2:40)

Theory only, no hands-on.

| Min | What | Slides |
|---|---|---|
| 145 to 150 | Sharing an experiment: a condition is a few lines, a layout is a JSON file | 32 to 33 |
| 150 to 155 | Own widgets and own algorithms: a widget, a policy, a recommender | 34 |
| 155 to 160 | Own scenarios, and contributing with AI coding tools | 35 |

### Part 6 · Wrap-up (2:40 to 2:45)

Three take-aways, where the material is, how to stay in touch (slides 36 to
37). Save the records a last time before anyone closes the server.

## After the workshop

1. Save the records (`--save`) and write the table (`--csv`).
2. Delete the records with the participant ID `no-data`.
3. Collect the run files participants' browsers downloaded, if the server
   copy is incomplete.
4. Stop the server, or switch the sink off.
5. Note what went wrong, for the next time.

## Reading the results

```bash
python scripts/workshop_results.py workshop-backup --csv workshop-results.csv
```

The script prints, per concept: workload (NASA-TLX raw, 5 to 100), trust
(Jian, 1 to 7), perceived understanding (1 to 7), total delay and the number
of decisions, each as mean, standard deviation and n. The last column is the
difference within each participant who did both runs. Below it: the mode
items, workload by position (the order effect), and the open answers.

With 20 participants, a difference between the concepts is an observation to
discuss, not a result to report.
