# Tour picker: a grouped list, and the dispatcher demos as tours

> **Status:** plan, 2026-11-06, on `explore_db`.
>
> **Why:** the two synthetic dispatcher demos fix network, layout, mode and course,
> which makes them tours, yet they sit as cards under **Build your own**. The tours
> themselves are 14 flat entries in a dropdown, where you only ever see the
> selected one, so it is hard to keep an overview.

## Decisions

- **D1: one list, six groups.** The Introduction door shows every tour at once,
  grouped by what you want to see: Introduction, Recommendation, Co-Learning,
  Director, The AI learns, Watch a dispatcher. Modes alone do not fit: learning AI
  cuts across them, and when watching you are not the dispatcher.
- **D2: the group is a field of the tour** (`Tour.group`). A tour in the
  Introduction door must have one. Experiments-door tours have none.
- **D3: native radio inputs in `fieldset`/`legend`.** The doors already are a Lyne
  radio group, and the door's `change` handler must not see the inner radios.
  Native form controls are already used inside the doors.
- **D4: short names in the list.** `tours.<id>.short` drops what the group already
  says and falls back to the full name. The full name stays everywhere else.
- **D5: demos are tours** (`dispatcher-recommendation`, `dispatcher-director`), via
  `Tour.dispatcherDemo`. They keep their backend recipe and start right away, with
  no opening pages, and they get a `#/tour/<id>/start` link.
- **D6: demos carry no run reference.** The backend keeps rejecting synthetic runs
  with a `run`, so they stay out of study data. `startTour` branches before any
  tour run or demo state is set up.
- **D7: Build your own keeps the Operator field.** Configuring a synthetic operator
  yourself is what that door is for. Only the cards leave.

Not in scope: the wider start-menu redesign, and any change to Experiments.

## New files

| File | Adds |
|---|---|
| `docs/plans/tour-picker-groups.md` | This plan |

## Modified files

| File | Change |
|---|---|
| `frontend/src/app/core/demo/tours.ts` | `TourGroup`, `TOUR_GROUPS`, `Tour.group`, `Tour.dispatcherDemo`, group per tour, two new tours |
| `frontend/src/app/core/demo/tours.spec.ts` | Every Introduction tour has a group; Director tempo and corridor checks skip demos |
| `frontend/src/app/app.component.ts` | `tourGroups`, `tourShortLabel`; `startTour` hands demo tours to `startPreparedDispatcherDemo`, which now takes the tour |
| `frontend/src/app/app.component.html` | Grouped list replaces the dropdown; demo cards removed |
| `frontend/src/app/app.component.scss` | List styles; card styles removed; Start in an opaque bar that stays in reach while the list scrolls |
| `frontend/public/i18n/{en,de,fr}.json` | `welcome.tour.group.*`, `tours.<id>.short`, the demo tours; card keys removed |
| `frontend/e2e/support/pages.ts`, `matrix.ts` | `selectTour` checks a radio; demos start as tours; the generic tour walk skips them |
| `frontend/e2e/dispatcher.spec.ts` | New test: a demo starts from its link, outside any tour run |
| `docs/dispatcher-agents.md`, `docs/plans/synthetic-dispatcher.md`, `docs/README.md` | Where the demos are now |

## Acceptance

1. All tours are visible at once in their groups, each with its duration.
2. Selecting a tour shows its description and, where it has one, its live variant.
3. **Start** and `#/tour/<id>/start` start both demos; no cards remain under Build.
4. A demo's session is synthetic and carries no `run`.
5. Selecting a tour leaves the open door unchanged, and arrow keys move between tours.
