# Simplifying the explore_db working screen

Status: first pass done (2026-11-15). This is a running list of what was removed
or hidden from the default working screen, and what is still open.

## Done

| What | How | Where |
|---|---|---|
| Recommendation / Co-Learning / Director tabs in the header | Hidden by default: `control.modeTabs` in the deployment `ui-config.json`. The code stays. | `frontend/public/ui-config.json` |
| "Loaded random infrastructure" / "Loaded scenario preset: …" at the top right, next to the status bar's own loading state | Hidden by default: `control.sessionInfo` in the same file. Errors still show there. | `frontend/public/ui-config.json` |
| The step counter in Situation Summary, which repeated the status bar's `Step n / max` | Removed from the panel. The status bar keeps it, and it is also the only counter in Director, which drops the left column. | `situation-summary.component.{html,scss}` |
| No way to pick a mode for a human "Build your own" session once the tabs were hidden | The Build door's mode picker, which used to appear only with a dispatcher, now shows for every operator. Co-Learning stays disabled for a synthetic dispatcher. | `dispatcher-config.component.ts` |

## Modified files

| File | Change |
|---|---|
| `frontend/public/ui-config.json` | Hides `control.modeTabs` and `control.sessionInfo` for every deployment. |
| `frontend/src/app/app.component.html` | Review marker on the mode-tab strip. `app-config-shell` carries `data-interaction-mode` so tests can read the mode without the tabs. |
| `frontend/src/app/features/situation-summary/situation-summary.component.{html,scss}` | The run-clock row and its styles are removed. |
| `frontend/src/app/features/dispatcher-config/dispatcher-config.component.ts` | The mode `<select>` moves out of the dispatcher-only block. Choosing Co-Learning resets the dispatcher config only when there is one. |
| `frontend/e2e/support/pages.ts` | `expectMode` reads `data-interaction-mode`. `WorkingScreen.switchMode()` (mode tabs) is replaced by `WelcomePage.selectMode()` (Build door picker). |
| `frontend/e2e/build.spec.ts` | Picks the mode on the Build door before the session starts. |

## Open: should a run be able to change its mode?

With the tabs hidden, the mode is set before the run starts. It comes from:

- the tour,
- the experiment condition,
- the dispatcher demo,
- the Build door's mode picker.

The run then keeps that mode.

To decide:

1. **No mode change during a run.** Delete the tab strip and
   `control.modeTabs`. Nothing else needs to change: the Build door already
   picks the mode, and the E2E no longer uses the tabs.
2. **Mode change stays.** Move the choice to a quieter place, such as a "Mode"
   section in the ☰ menu, and remove `control.modeTabs` from
   `ui-config.json`.

`AGENTS.md` asks for the three modes to be "switchable". Option 1 still meets
that when "switchable" means "chosen per session". Write down which reading we
take.

## Candidates not taken this round

- The Agent Inspector's MOVING / WAITING lists repeat the Agents panel.
- The Recommendations panel repeats the recommendation shown in the Agent
  Inspector.
