# Widget spec — AI Track Record (first cut: the MARL lab review)

> Dated spec, 2026-10-19. Status: **confirmed and built (first cut), 2026-10-19.** Part of
> [`marl-lab-plan.md`](marl-lab-plan.md), step 4. First cut of the planned
> catalog entry A3, scoped to sessions that run a learned policy.

## 1. Identity

- **Name:** AI Track Record
- **`kind`:** trust
- **`granularity`:** overview
- **Default zone:** right
- **Panel `type`:** `ai-track-record`
- **Catalog id:** A3 (status `planned` → `first-cut`)
- **Source(s):** [D3.1] calibration of reliance; [DB] owner's calibration-mirror line
- **Grounding reference:** HG-DAgger / IWR (interventions as the learning
  signal, Kelly 2019; Mandlekar 2020) and the calibration-of-reliance line of
  D3.1: the human sees how often they stepped in, how often they agreed with the
  AI, and whether stepping in paid off against "AI alone".
- **Source origin:** from-scratch, deliberately. The numbers come from the
  lab's own intervention log (`app/core/intervention_log.py`) and the existing
  branch runner (`app/core/scenario_runner.py`). A3S/TraceRL is the reference
  for the what-if semantics (fork from a step, roll forward); there is no
  consortium code for an intervention track record.

## 2. Promise

> See how you and the learned policy worked together in this session: how often
> you stepped in, how often you agreed, and whether the run went better with you
> than with the AI alone or with the previous checkpoint.

## 3. Per-mode behaviour

Available in all modes, **only in a session that runs a learned policy**
(`learned_ppo` or `lab:<name>`). Elsewhere it shows an empty state saying so.
The numbers are the same in every mode; the framing follows the mode's
authority (brief §0):

- **Recommendation (WP 3.1):** "You followed the AI's recommendation in N of M
  decisions." Interventions read as *not following* the recommendation.
- **Co-Learning (WP 3.3):** "You and the AI chose the same in N of M." No
  judgement of who was right; the outcome comparison carries the evidence.
- **Director (WP 3.4):** "You took over N times in S steps (rate per 100
  steps)." Interventions read as *taking over* from the autonomous AI.

## 4. System interaction

- **Data in:** `GET /session/{id}/lab/review` (new), `SessionStore.activePolicy`,
  `interactionMode`, `elapsedSteps`.
- **Actions out:** none (read-only). A "Refresh" button re-runs the outcome
  comparison, which costs a few seconds on Olten.
- **Backend table:**

| Field / capability | Available now | To build |
|---|:---:|:---:|
| Intervention lines per session (obs, AI action, human action, agreed, mode, owner) | ✓ (step 2) | |
| Counts, agreement, rate per 100 steps, split by mode | | ✓ `lab/review` |
| Snapshot of the env at the first human override in a learned session | | ✓ (fork at request time) |
| "With you": the current state, the rest driven by the AI to the episode end | ✓ branch runner | ✓ wire |
| "AI alone": from the snapshot, no overrides, to the episode end | ✓ branch runner | ✓ wire |
| "Previous checkpoint": the same from the snapshot, with the checkpoint's `base` | ✓ branch runner + sidecar | ✓ wire |
| Strategy choices in co-learning (chosen vs offered) | | ✓ `runs/<id>/choices.jsonl` |

The forks draw no new random breakdowns of a live run (the branch runner's
rule); a preset's scripted malfunctions travel with the fork. All three
outcomes are compared on the same future.

## 5. Allocation & accountability touchpoints

- **Loop stage:** capitalization (after or during the run).
- **Owner per mode:** human in Recommendation and Co-Learning; AI in Director,
  human taking over.
- **Decision events emitted:** none new. It reads the intervention log that
  `OverridePolicy` already writes; system holds (`owner: "system"`) are left out.

## 6. Acceptance scenario

> Director session on the PF-CH wn–wal conflict under `learned_ppo`. Override
> the train that would block the single track (3–5 overrides). Open the AI Track
> Record: it shows the overrides, the agreement share, the rate, and three
> outcome rows. "With you" arrives 3/3 where "AI alone" arrives 1/3 (the
> measured ECML baseline). Switch the mode chip to Recommendation: same
> numbers, the wording changes to "followed the recommendation". **Q2
> (calibrated trust):** the human can name, from the panel alone, whether
> stepping in paid off.

## 7. Effort & changes

- **Effort:** M.
- **Files:** `backend/app/api/lab.py` (new router), `app/core/intervention_log.py`
  (snapshot + choices), `app/api/overrides.py` / `contention_strategies` apply
  path (hooks), tests; frontend `features/ai-track-record/`, `api.service.ts`,
  the six widget seams, `en/de/fr.json`, `panel-mode-matrix.md`,
  `widget-catalog.md`.

## 8. Open questions / risks

- **Own algorithm:** none. Counting and forking only.
- The outcome comparison draws no new random breakdowns (live runs). Stated in
  the panel.
- One snapshot per session (the first intervention). A session reset clears it.
- The intervention rate needs a denominator: per 100 steps is honest and
  simple; "per decision" would need every step's decision count logged, which
  step 2 does not do.
