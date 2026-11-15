# Workshop "Supportive AI & Co-Learning": participant guide

You need a laptop with a current browser (Chrome, Edge, Firefox or Safari)
and the card you were handed. Nothing has to be installed.

## Your data

> **Draft, to be confirmed by the organisers before the workshop.**
>
> During the two runs in Part 2 the app records what you do on the screen
> (clicks, decisions, timing) and your questionnaire answers. It records no
> name, no e-mail address and no camera or microphone. The code on your card
> only links your two runs. The data is used for research in AI4REALNET.
>
> Taking part in the recording is voluntary. If you do not want your data
> used, type `no-data` instead of your code. You can do everything in the
> workshop either way.

## Part 2 · Experience: two runs

You are a train dispatcher on the line along the Walensee in Switzerland.
Three trains run to the timetable. Part of the line is single track, so two
trains cannot pass each other there. In each run something goes wrong, and
an AI supports you. The AI is not the same in the two runs.

**Your goal in both runs: keep the delay of all trains as small as
possible.**

### Run 1

1. Open **link 1** on your card.
2. On the start screen, check that the experiment named on your card is
   selected (for example "Workshop A1"). Type your code (for example `A07`)
   into **Participant ID**.
3. Wait for the signal, then press **Start experiment**.
4. Read the two pages, then press **Start scenario**. The simulation starts
   by itself.
5. Follow the guide strip at the top of the screen. It names the next step
   and the panel to look at.
6. When the disruption occurs, decide what the affected train should do. The
   simulation waits for you where it needs your decision. If it stays paused
   afterwards, press **Play**.
7. When all trains have arrived, or you are told to, press the button at the
   top right to finish the scenario.
8. Answer the questionnaire. There are no right or wrong answers. Answer for
   the run you just did.

Please work alone and do not look at your neighbour's screen. Your neighbour
works with the other AI.

### Run 2

The same steps with **link 2** and the same code. The disruption is a
different one.

### Reading the screen

| Where | What |
|---|---|
| Left | The situation in numbers, and the messages of the traffic management system |
| Centre | The track map with the trains. Drag it sideways, zoom with the mouse wheel. Below or as a second tab: the time-distance diagram, where a line is a train, time runs downwards and a crossing of two lines in the single-track section is a conflict |
| Right | What the AI offers, and where you decide |
| Top | The guide strip, the Play and Pause button and the button that finishes the scenario |

### If something goes wrong

- The page does not react: reload it. Your run continues.
- You are in the wrong experiment: open the link again.
- Anything else: raise your hand.

## Part 4 · Design: build your own experiment

You now change sides. In a group of three or four you design a small
experiment, build it, and try it on a person from another group.

1. **Agree on one question** (10 minutes). Fill in the
   [experiment design canvas](experiment-design-canvas.md). Keep it small:
   one thing that differs between two conditions.
2. **Build it** (20 minutes). On the start screen choose **Build your own**.
   You can set:
   - the interaction mode: Recommendation, Co-Learning or Director;
   - who dispatches: a human, a synthetic dispatcher, or a human with a
     digital shift partner;
   - the network and the scenario;
   - the layout: one of the prepared ones, or your own.

   For your own layout open the **Layout Designer** (menu, or add
   `#/designer` to the address). Add, remove and move widgets, save the
   layout, and export it as a JSON file to share it. The **widget gallery**
   (`#/widgets`) shows every widget, the **scenario gallery** (`#/scenarios`)
   every network and scenario.

   Choose what to measure: the questionnaire parts are in the session
   settings.
3. **Pilot it** (10 minutes). One person from the neighbouring group runs
   your experiment. Do not help. Write down where they hesitate, what they
   ask and what they do that you did not expect.
4. **Show it** (2 minutes per group). Your question, what you changed, and
   one thing the pilot taught you.

Before you leave, export your layout ("Export JSON" in the Layout Designer)
and one session ("Export session data" in the footer), and hand in your
canvas.

## To take home

- The Flatland UI Hub: <https://github.com/flatland-association/flatland-ui-hub>
- AI4REALNET and its public deliverables: <https://ai4realnet.eu/deliverables/>
- The questionnaires: `AI4REALNET/hmisurveys` on GitHub
