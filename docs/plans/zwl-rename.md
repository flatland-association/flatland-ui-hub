# ZWL, not Zug-Weg: rename the Zug-Weg-Diagramm in code and docs (#173)

> **Status:** plan, 2026-11-05. Based on `main` 333013c (after #171 was
> merged). Built: S1–S4 committed.
> Issue [#173](https://github.com/flatland-association/flatland-ui-hub/issues/173)
> ("Rename zug-weg-diagram throughout the project", @CleverManu).
> Branch `feature/173-zwl-rename`, off `main` (on request; contributors
> usually branch off `explore_db`, which has more Zug-Weg uses, §9). Open
> questions are in §7.
>
> **Why:** ZWL stands for *Zeit-Weg-Linie(ndiagramm)*, the time-distance
> diagram, not for "Zug-Weg". The screens already say so; the code and the
> docs still say "Zug-Weg-Diagramm" in many places, which confuses anyone
> who reads both.

### Status

| ID | Commit message | SHA |
|---|---|---|
| S0 | docs(plans): plan for #173, the ZWL instead of the Zug-Weg-Diagramm in code and docs. | 9e11e89 |
| S1 | refactor(zwl): rename the zug-weg-diagramm component to zwl. | ec77f51 |
| S2 | refactor(zwl): rename the store's Zug-Weg route and the tour constants to ZWL. | 4c2091d |
| S3 | docs(zwl): say ZWL instead of Zug-Weg-Diagramm in comments and docstrings. | 8b0774c |
| S4 | docs(plans): rename the Zug-Weg plans to ZWL and update their links. | 01ea6fc |

### Design principles

- **Rename what stays in the code, keep what leaves it.** Names that only
  the source reads are renamed; every stored or logged ID keeps its value
  (D1, D6).
- **The screens are the reference.** Prose uses the words the UI already
  shows (D3); no displayed text changes.
- **One short form, the existing one:** `zwl` (D2). The component's CSS
  prefix `zwd` stays, as it does not say Zug-Weg.
- **History is not rewritten** (D5, §1.1).

Reused concepts:

| Need | Reused concept | Instead of |
|---|---|---|
| A short form for new names | `zwl`, already in `widget-linkmap-zwl.md`, `zwl-improvements-briefing.md`, `zwl-default.md` | a new abbreviation (`zwd`, `tdd`) |
| Old titles in saved designs still translate | the legacy-title map in `core/i18n/panel-titles.ts` (unchanged) | a migration of saved designs |
| Which IDs must not change | the AGENTS.md rule for `data-log` i18n keys, extended to every stored or logged ID (D1, D8) | aliases or a renaming migration |
| File history across the rename | `git mv` (D5) | stub files that point to the new name |

### Terms

- **ZWL** — *Zeit-Weg-Liniendiagramm*, in English the *time-distance
  diagram*: time on one axis, the stations of a section on the other, one
  line per train. The widget is B4 in the widget catalog.
- **`zwd`, `zwl.*`** — the ZWL's CSS classes (`zwd__*`), tokens
  (`--app-zwd-*`) and i18n keys (`zwd.*`, also the localStorage key
  `zwd.orientation`) keep the prefix `zwd` (D1). The i18n namespace `zwl.*`
  belongs to the archived Marey chart, not to the ZWL.
- **ZWL section** — the two stations the ZWL draws between. Held in
  `SessionStore.zwlRoute`, its axis loaded into `zwlRouteAxis`
  (`RouteAxisResponse`, backend `route_axis.py`): "route" in symbols and
  "section" in prose are the same thing. Not a train's run.
- **Zug-Weg-Diagramm** — the widget's old working name. Wrong in substance
  (#173), and the name this plan removes.
- **Stored or logged ID** — a string that leaves the source code: saved in
  the browser (Layout Designer designs), written into a deployment file
  (`ui-config.json`), recorded in the study data (session record, click log,
  UI-state stream), or typed by people (deep links). Renaming one breaks
  what was saved, logged or linked before.

### Components

| Component | Responsibility | Change |
|---|---|---|
| `ZwlComponent` (was `ZugWegDiagrammComponent`) | Draws the time-distance diagram (widget B4) for a section or a train's run. Not for picking the layout or logging clicks; those stay with the panel host and the click log. | 🟨 modified: new class, selector and folder name; nothing visible changes. |
| `SessionStore` | Holds the session's view state, among it the ZWL's chosen section. Not stored or logged. | 🟨 modified: the section's signals and setter are named `zwl…`; nothing visible changes. |
| `TourBriefing`, `ExperimentLeg` | Describe a tour or study leg, including the section the ZWL opens on. | 🟨 modified: the field is named `zwlRoute`; tours open on the same section. |
| Plans `widget-b4-zwl.md`, `zwl-route-selection.md` | The specs of the widget and of the section picker. | 🟨 modified: new file names; same content in ZWL terms. |

## 1. What the issue asks for

> ZWL steht für Zeit-Weg-Linie (Diagramm), nicht für zug-weg-linie. Im
> Projekt ist teilweise von zug-weg-diagramm die Rede -> ist verwirrend und
> sollte gemäss definierter Terminologie angepasst werden.

Requirements:

1. Wherever the project names the diagram, it says ZWL / Zeit-Weg-
   Liniendiagramm / time-distance diagram, not Zug-Weg.

### 1.1 Scope, assumptions and exclusions

- **Scope: code and docs, IDs kept** (D6). What is renamed and what is kept:
  §4; the kept IDs: §4.3.
- **History stays.** Commit messages (`feat(zug-weg): …`), the dated
  records under `docs/delegation/` and the plans' records of the 2026-09
  naming decision (§6) describe what was, and are not rewritten; the
  latter get a line pointing to #173.

Assumptions. Not checked in code; they hold by construction of the repo
today:

- **The screens are already right.** Every displayed text (`en`, `de`, `fr`)
  already says "Zeit-Weg-Liniendiagramm (ZWL)", "ZWL", "time-distance
  diagram" or "graphique espace-temps" (renamed in e1785b8). This plan
  changes no displayed text and no translation.
- **Only this repo's source reads the renamed symbols and paths.** No other
  repo imports the component or the store; the selector and the class name
  are not logged (§4.1).
- **§4.3 is complete:** every value that leaves the source is listed there.
  The grep of §6 is what finds a missed one.

### 1.2 New patterns

Compared with `main`; the reused concepts are listed under the design
principles.

None. The rename moves no logic, and no behaviour changes.

Not new on purpose: no ID alias, no migration of saved designs, no new i18n
key, no change to `ui-config.schema.json`, no data-model change.

### 1.3 Breaking changes

- **For the study data, deployments, saved designs and deep links: none**
  (D1).
- **Source level:** the component, its folder, and the store, condition and
  preset names change. Branches that import
  `zug-weg-diagramm.component`, use `<app-zug-weg-diagramm>` or set
  `zugWegRoute` on a leg or briefing get a compile error after rebasing, and
  need the new names (§4.1, §4.2). Open PRs, checked 2026-11-05:
  - #162 (`perf/initial-bundle-size`, into `explore_db`) lazy-imports
    `features/zug-weg-diagramm/zug-weg-diagramm.component` and moves the
    `<app-zug-weg-diagramm>` tags: it needs the new path and selector.
  - #113 edits `zug-weg-route-selection.md`: git follows the rename (D5),
    links in its diff need the new name.
  - #164 names `SessionStore.zugWegRoute` in a plan's prose only; #161 and
    #172 touch the same files but use only kept IDs.
  - `explore_db` itself: §9.
- **Links to the two renamed plans** (§4.4) that point at a branch, e.g. a
  `blob/main/docs/plans/zug-weg-route-selection.md` URL in an earlier PR or
  issue, stop resolving. Links pinned to a commit keep working. See Q1.

### 1.4 Limitations

- The kept IDs (§4.3) still say "zug-weg": in the click log, the UI-state
  stream, saved designs, `ui-config.json` and deep links. Follow-up in §8.
- The rename covers `main`; the Zug-Weg uses that exist only on
  `explore_db` stay until the maintainer renames them in the next merge
  into `explore_db` (Q2, §9).

## 2. Today (checked 2026-11-05 on `main`, `333013c`)

58 tracked files contain "zug-weg", "zug_weg", "zugweg" or "Zug-Weg" (any
case), one of them under `docs/delegation/`:

| Kind | Where | Count |
|---|---|---|
| Folder and file names | `frontend/src/app/features/zug-weg-diagramm/` (component `.ts/.html/.scss`, `zug-weg-axis.ts`), `docs/plans/widget-b4-zug-weg-diagramm.md`, `docs/plans/zug-weg-route-selection.md` | 4 files, 2 plans |
| TypeScript symbols | `ZugWegDiagrammComponent`, selector `app-zug-weg-diagramm`, `SessionStore.zugWegRoute`/`zugWegRouteAxis`/`zugWegRouteComplete`/`setZugWegEnd`/`_zugWegRouteKey`, `zugWegRoute` on `TourBriefing` and `ExperimentLeg`, the `OLTEN_ZUG_WEG_*`/`WALENSEE_ZUG_WEG_*` briefing constants, the `OLTEN_ZUG_WEG`/`ZUG_WEG_CORRIDOR` preset constants | ~70 uses |
| Comments and docstrings | frontend (store, map, presets, briefings, catalog, `styles.scss`, …) and backend (`hmi.py`, `route_axis.py`, `contention_strategies.py`, two tests) | ~60 |
| Data prose | the `description` of two disturbance fixtures (`olten-breakdown-south.json`, `strategy-e1-breakdown-weesen.json`) | 2 |
| Docs | 11 plans, `AGENTS.md`/`CONTRIBUTING.md` (commit-scope example `feat(zug-weg)`); `panel-mode-matrix.md` and `experiment-logging.md` name only the kept widget type | ~75 |
| Stored or logged IDs | §4.3 | kept |

## 3. Decisions

All decided 2026-11-05.

| ID | Decision | Why |
|---|---|---|
| D1 | ✅ Stored and logged IDs keep their value (§4.3). | Changing one mid-study splits the data into "before" and "after" values for the same widget, and breaks saved designs, deployment files and deep links. AGENTS.md already forbids renaming the i18n keys that serve as `data-log` ids. |
| D2 | ✅ New names use `zwl` (`ZwlComponent`, `app-zwl`, `features/zwl/`, `zwlRoute`). | Matches the existing `zwl` plans; the issue's terminology. |
| D3 | ✅ In prose: "ZWL" in short, "Zeit-Weg-Liniendiagramm (ZWL)" or "time-distance diagram (ZWL)" on first mention. "Zug-Weg section/route" becomes "ZWL section". | Same words as the screens. |
| D4 | ✅ Each kept ID gets no comment of its own, except the ActionOrigin `'zug-weg'` and the widget type, which get one line saying the value is kept for the study data (#173). | Those two are where a reader would otherwise "fix" it. |
| D5 | ✅ The two plans are renamed, with `git mv` (Q1, §4.4). | So `git log --follow` keeps their history. |
| D6 | ✅ Scope (user): comments, docstrings, docs, plan files, file and folder names and TypeScript symbols are renamed; stored and logged IDs are not (D1). | Rejected: also renaming the IDs, behind aliases (changes the study data mid-study); only prose (leaves the confusion in every import). |
| D7 | ✅ The Zug-Weg uses that exist only on `explore_db` are renamed by the maintainer in the next merge of `main` into `explore_db` (Q2, §9). | The `zugWegRoute` field must compile in that merge commit anyway. |
| D8 | ✅ AGENTS.md's Guardrails get a bullet: stored or logged IDs are not renamed, even when their wording is outdated (user). | Generalises D1 beyond the `data-log` i18n keys, so a later clean-up doesn't "fix" `zug-weg-diagramm`. |

## 4. Design

### 4.1 Component (S1)

`git mv frontend/src/app/features/zug-weg-diagramm frontend/src/app/features/zwl`,
with `zug-weg-diagramm.component.*` → `zwl.component.*` and `zug-weg-axis.ts`
→ `zwl-axis.ts`. `ZugWegDiagrammComponent` → `ZwlComponent`, selector
`app-zug-weg-diagramm` → `app-zwl`. Its users: `panel-plugin-host` (`.ts`,
five tags in `.html`) and `view-tabs/center-views.ts`; the Layout Designer
names only the widget type.
The selector is not logged: clicks are attributed through `data-panel-type`,
which carries the widget type (kept).

### 4.2 Store, legs and briefings (S2)

`SessionStore.zugWegRoute` → `zwlRoute`, `zugWegRouteAxis` → `zwlRouteAxis`,
`zugWegRouteComplete` → `zwlRouteComplete`, `setZugWegEnd` → `setZwlEnd`,
`_zugWegRouteKey` → `_zwlRouteKey`. The field `zugWegRoute` on
`TourBriefing` (`tour-briefings.ts`) and `ExperimentLeg`
(`study-conditions.ts`) → `zwlRoute`, read in `tour-context.service.ts`.
Constants in `tour-briefings.ts` `OLTEN_ZUG_WEG_*` → `OLTEN_ZWL_*`,
`WALENSEE_ZUG_WEG_*` → `WALENSEE_ZWL_*`; in `layout-presets.ts`
`OLTEN_ZUG_WEG` → `OLTEN_ZWL`, `ZUG_WEG_CORRIDOR` → `ZWL_CORRIDOR`. None of
these is stored or logged: the route is view state of the running session,
and the constants' `id` values stay (§4.3).

### 4.3 Kept IDs (D1)

| ID | Where it lives | Why it stays |
|---|---|---|
| Widget type `zug-weg-diagramm` | catalog, presets (also as `settings.tabs`/`defaultTab` of a view-tabs panel, #171), view tabs (`marey` maps to it), `view-tabs.component.spec.ts`, `ui-config.service.spec.ts` | saved Layout Designer designs (`localStorage`, with their tab settings); `data-panel-type` in the click log; `panel.view-tabs.tab` in the UI-state stream |
| UI-config id `widget.zug-weg-diagramm` | `ui-config.schema.json`, `ui-config-items.ts` | deployment `ui-config.json` files; the restrictions listed in the session record |
| ActionOrigin `'zug-weg'` | `train-action.service.ts` | recorded with every override as the measured affordance |
| Tour ids `olten-zug-weg`, `walensee-zug-weg`, briefing ids `…-en/-de`, live variants `…-live-en/-de` | `tours.ts`, `tour-briefings.ts`, `tours.spec.ts` | deep links (`/start` suffix); the run's tour in the record; i18n keys `tours.<id>.*` |
| Preset ids `preset-olten-zug-weg`, `preset-zug-weg-corridor`; panel ids `preset-*-zugweg`, `` `${prefix}-zugweg` `` | `layout-presets.ts` | `layoutId` in the session record; panel ids in the UI-state stream |
| i18n keys `panels.zugWegDiagramm`, `views.zugWeg`, `map.zugWeg.*`, `tours.*-zug-weg.*` | `public/i18n/*.json` and their users | `data-log` click ids (AGENTS.md); tour keys follow the tour id |
| Legacy title `'Zug-Weg-Diagramm'` → `panels.zugWegDiagramm` | `core/i18n/panel-titles.ts` | translates titles in designs saved before the rename to the i18n key |

### 4.4 Prose and plans (S3, S4)

S3 rewrites comments, docstrings and the two fixture descriptions by D3,
frontend and backend. S4 runs `git mv docs/plans/widget-b4-zug-weg-diagramm.md
docs/plans/widget-b4-zwl.md` and `git mv docs/plans/zug-weg-route-selection.md
docs/plans/zwl-route-selection.md`, updates the 12 files that link them
(the two plans included; also the catalog's `spec:` path, which no test
checks), rewrites the plans' prose, and changes the commit-scope example in
`AGENTS.md` and `CONTRIBUTING.md` to `feat(zwl): …`, and adds the
guardrail of D8 to `AGENTS.md`. S3 leaves plan links
alone; S4 changes them in every file, code included.

### 4.5 Steps

Each step is one commit, green on its own (§6's CI checks). None changes a
test's assertions: the specs use only kept IDs.

| ID | Contents | Needs | Blocked by |
|---|---|---|---|
| S1 | §4.1: folder, files, class, selector and their imports and tags | - | - |
| S2 | §4.2: store, leg and briefing fields, constants | S1 (edits `zwl.component.ts`) | - |
| S3 | §4.4: comments, docstrings, fixture descriptions; D4 lines | S2 | - |
| S4 | §4.4: plan renames, links, plans' prose, commit-scope example, AGENTS.md guardrail (D8) | S3 | - |

## 5. Files

### New files

| File | What it adds |
|---|---|
| `docs/plans/zwl-rename.md` | this plan |

### Renamed files (content changes too)

| From | To |
|---|---|
| `frontend/src/app/features/zug-weg-diagramm/zug-weg-diagramm.component.{ts,html,scss}` | `frontend/src/app/features/zwl/zwl.component.{ts,html,scss}` |
| `frontend/src/app/features/zug-weg-diagramm/zug-weg-axis.ts` | `frontend/src/app/features/zwl/zwl-axis.ts` |
| `docs/plans/widget-b4-zug-weg-diagramm.md` | `docs/plans/widget-b4-zwl.md` |
| `docs/plans/zug-weg-route-selection.md` | `docs/plans/zwl-route-selection.md` |

### Modified files

| File | What changes |
|---|---|
| `frontend/src/app/core/session.store.ts` | route signals and setter renamed (§4.2), comments |
| `frontend/src/app/core/demo/tour-briefings.ts`, `study-conditions.ts`, `tour-context.service.ts`, `tours.ts` | `zwlRoute` field, constants, comments; ids kept |
| `frontend/src/app/features/flatland-map/flatland-map.component.{ts,html,scss}` | store names, comments |
| `frontend/src/app/features/layout/components/panel-plugin-host/panel-plugin-host.component.{ts,html}` | import, `<app-zwl>` |
| `frontend/src/app/features/view-tabs/center-views.ts`, `view-tabs.component.ts` | import, comments |
| `frontend/src/app/features/layout-designer/layout-designer.{component.ts,models.ts}` | comments only (they use the widget type, kept) |
| `frontend/src/app/core/widgets/widget-catalog.ts` | `spec:` path, comments; D4 line on the type |
| `frontend/src/app/core/dispatch/train-action.service.ts` | comment; D4 line on `'zug-weg'` |
| `frontend/src/app/core/layout/layout-presets.ts` | constants `OLTEN_ZWL`, `ZWL_CORRIDOR` (§4.2), comments; ids kept |
| `frontend/src/app/core/models.ts`, `api.service.ts`, `contention-anchor.ts`, `motion/smooth-clock.service.ts`, `styles.scss` | comments only |
| `backend/app/api/hmi.py`, `backend/app/core/route_axis.py`, `backend/app/core/contention_strategies.py`, `backend/tests/test_hmi_contentions.py`, `backend/tests/test_hmi_plan.py` | docstrings, comments, plan links |
| `backend/app/fixtures/olten/disturbances_tour/olten-breakdown-south.json`, `backend/app/fixtures/pf_ch/disturbances_tour_long_approach/strategy-e1-breakdown-weesen.json` | `description` text |
| `docs/plans/{experiment-workflow,live-tours-shift-rounds,smooth-playback,tours-experiments-cleanup,widget-b6-director-divergence,widget-catalog,widget-e1-combined-actions,zwl-default,zwl-improvements-briefing}.md` | prose, links |
| `AGENTS.md` | commit-scope example; Guardrails: a bullet against renaming stored or logged IDs (D8) |
| `CONTRIBUTING.md` | commit-scope example |

Not changed: `frontend/public/i18n/*.json`, `frontend/public/ui-config.schema.json`,
`frontend/src/app/core/config/ui-config-items.ts`, `frontend/src/app/core/i18n/panel-titles.ts`,
`frontend/src/app/core/demo/tours.spec.ts`, `frontend/src/app/features/view-tabs/view-tabs.component.spec.ts`,
`frontend/src/app/core/config/ui-config.service.spec.ts`, `layout-designer.component.html`,
`view-toggle.component.html`, `docs/reference/panel-mode-matrix.md`, `docs/experiment-logging.md`
(ids only, §4.3), `docs/delegation/`.

## 6. Verification

- `git grep -niE 'zug[-_ ]?weg'` lists only the kept IDs of §4.3, the
  D4 lines, this plan, `docs/delegation/`, and the dated records of the
  2026-09 naming decision (`tours-experiments-cleanup.md` §4,
  `zwl-improvements-briefing.md` §7.2, the header note of `widget-b4-zwl.md`),
  which keep the old name as history and point to #173. (`[-_ ]` also catches the
  `ZUG_WEG` constants and "Zug-Weg diagram".)
- The four CI checks: `npm run lint:styles`, `npm run i18n:check`,
  `ng build --configuration production`, `pytest -q`; and `ng test`.
- In the running app: the tour "Olten: explore the time-distance diagram"
  opens the ZWL on its section (P-BERN → P-BASEL), picking a section on the
  map still works, and a saved Layout Designer design with the ZWL still
  loads.

## 7. Open questions

✅ ~~**(Q1) Rename the two plan files?**~~ **Decided 2026-11-05:** yes,
with `git mv` (S4, D5): `widget-b4-zug-weg-diagramm.md` → `widget-b4-zwl.md`,
`zug-weg-route-selection.md` → `zwl-route-selection.md`. Four PRs link them:
#89, #103, #105 (closed) and #113 (open); their branch links stop resolving
(§1.3), as history, like the commit messages (§1.1). #113 has to rebase
anyway. Not taken: keeping the names, which leaves "zug-weg" in two paths
that the code and plans link to.

✅ ~~**(Q2) Who renames the Zug-Weg uses that exist only on `explore_db`?**~~
**Decided 2026-11-05:** a), the maintainer, in the next "merge main into
`explore_db`" commit (§9, D7). `origin/explore_db` (3e6a739, 2026-11-05)
does not yet contain #171, and adds Zug-Weg uses that `main` does not have:
a `zugWegRoute` on a Walensee briefing in `tour-briefings.ts` (a compile
error once S2 arrives), a comment, widget-type uses (kept), and prose in
`control-room-patterns.md` and `ai-ux-guidelines.md`. Not taken: a
follow-up PR against `explore_db` (the field must compile in the merge
commit anyway); retargeting this branch to `explore_db` (contradicts the
request to branch off `main`).

## 8. Follow-ups (not in this PR)

| Follow-up | Why not in this PR | From | Findings | Issue |
|---|---|---|---|---|
| Rename the stored and logged IDs (§4.3), with a migration of saved designs and a mapping for the study data. | Changes the study data mid-study (D1). After the study at the earliest. | §1.4 | - | - |
| Rename the Zug-Weg uses that exist only on `explore_db`. | Not on this PR's base; done by the maintainer in the next merge of `main` into `explore_db` (Q2). | §1.4 | - | - |

## 9. Merging into `explore_db`

`main` reaches `explore_db` through the maintainer's "merge main into
`explore_db`" commits. Known conflicts, from `origin/explore_db` 3e6a739
(base 2026-11-05):

- `explore_db` changed `zug-weg-diagramm.component.ts` (66 lines) and
  `session.store.ts`, `tour-briefings.ts`, `layout-presets.ts`: git follows
  the folder rename (S1), but lines where S2/S3 renamed a symbol or a
  comment conflict; resolve by taking `explore_db`'s logic with the new
  names (§4.2).
- `explore_db`-only uses: the maintainer renames them in the merge commit
  (Q2): the `zugWegRoute` field (§4.2), the comment and the prose (D3).
- After the merge: §6's grep and checks on `explore_db`.
