# Control-room patterns — alarms, advice, control handover, focus, and what could flow back into Lyne

> **Status:** proposal, 2026-10-11. Nothing built yet.
> **Prior art:** a maritime control-room design system; sources, what was
> checked and the licence are in §10.

## 1. Why

Maritime control rooms (ship bridges) have a design system that has
already solved several problems that our three interaction modes run into:
supervising many units at once, alarm handling under high load, embedding
advice into instruments, and handing control over explicitly. Lyne, our design
system, was built for passenger-facing channels and has none of these
control-room patterns.

The goal of this plan has two parts:

1. **Learn:** adopt these *patterns and semantics* where they serve the
   modes (above all Director, WP 3.4), and build them in Lyne.
2. **Give back:** collect what proves itself in our studies as a well-grounded
   proposal for Lyne (and possibly for the maritime prior art, in the other direction).

## 2. Ground rules

- **Patterns, not code.** The prior art is AGPL-licensed (§10). Our repo is
  Apache 2.0 and public. We copy no source, CSS or icons. We take structure,
  naming and behavioural rules, and cite the source.
- **Lyne stays the design system** (AGENTS.md, "Keep the stack"). New
  components are compositions of Lyne elements plus app tokens (`--app-*`),
  and we add no dependency on the prior art.
- **The consortium comes first.** Before we fix any naming (severities, alarm
  states), check the AI4REALNET / flatland-association repos and InteractiveAI
  for terms that already exist (§8, open question 1). If they name something
  differently, follow the consortium and note where the prior art differs.
- **Modes stay in `InteractionMode`.** Everything mode-specific is gated by
  presentation in the frontend (brief §6).
- **i18n and tokens** as usual: every new label is a key in `en/de/fr.json`, and
  every new colour (e.g. severity levels) is a new token in `styles.scss`.

## 3. Prior art (as of the check, §10)

| Area | Maritime prior art | Observation |
|---|---|---|
| Integration shell | `src/integration-systems/`: `obc-integration-bar`, `-tabs`, `-fleet-button`, `-vessel-selector`, `-vessel-menu`, `-app-bar` (all `@experimental`) | **Presentation only**: slots plus boolean properties. Context management ("manages context across apps") is left to the application, and the tab click carries no id. |
| Alarm model | `src/alert-severity.ts`, `types.ts` | Levels `critical`, `high`, `medium`, `low`, `diagnostic`, plus maritime `alarm`, `warning`, `caution`. Defined centrally per level: ACK required, blink tempo, sort priority, counter labels with accessible names. |
| Advice | `advice-button` (`flat`, `normal`, `enhanced`), `advice-floating-item`, `advice-message-item`, `advice-menu-item` | Advice has its own category with its own icon and colour, separate from alarms and notifications. Up to two actions. |
| Control handover | `command-button` (`inCommand`), `command-menu` (status, description, location, take/release toggle) | The maritime pattern for "who is in command here". |
| Sequences | `sequence-card`, `sequence-step`, `sequence-toolbar` … | Timeline of steps with states (`active`, `flat`, `enhanced`). |
| Palettes | Day, Dusk (beta), Night (beta), Bright (beta); `palettes/critical.md` | Alarm colours and focus outlines defined per brightness level. |
| Pages | `alert-list-page-small`, `alert-detail-page` | Reference layouts for an alarm list and alarm details. |

## 4. Workstreams

Each workstream needs its own spec (widget spec via `create-widget`, or a
plan) before any code is written. This plan only sets the order and the
boundaries.

### A — Focus context and integration bar

**Problem.** Every widget reacts to `SessionStore.selectedHandle`, but the
contract is implicit, and no single place shows *which* train is in focus. In
Director there is also no fast switch between "whole network" and "one train".

**Proposal.**
1. *Write down the contract:* widgets read focus only from the `SessionStore`
   and keep no selection of their own. Add this to
   `docs/reference/component-shell-plugin-api.md` and the `create-widget`
   checklist.
2. *Focus bar* in the shell: a "Network" button (≙ fleet), tabs for the
   pinned or affected trains, each with its alarm state (workstream B). An
   alarm on a train that is not in focus stays visible in its tab.
3. *Multiple screens (optional, later):* several browser windows of the same
   session sync `selectedHandle` and the time position through
   `BroadcastChannel`. Useful for WP4 setups closer to a real control room.

**Do not touch:** the centre tabs (`center-view-tabs.md`) and the three-zone
contract (`mode-layouts-three-zones.md`). The bar sits above them.

### B — Alarm model with acknowledgement

**Problem.** `triaged-events` derives an `Urgency`
(`act-now`, `soon`, `observe`) per notification and has no acknowledgement
state. In Director the supervisor cannot see what they have already taken
note of. The study logs also lack an "acknowledged at t" signal.

**Proposal.**
1. A central, pure helper `core/alert-severity.ts` (our own code): level →
   token, ACK required, sort order, accessible counter label. The level names
   follow the consortium (open question 1). Otherwise use the prior-art
   levels, which follow IEC 62923 (bridge alert management) and match our
   EEMUA 191 grounding in the C2 spec.
2. Acknowledgement state in the `SessionStore`
   (`acknowledgeAlert(id)`), unacknowledged counters per train for the
   focus bar (A).
3. Logging: every ACK goes into the interaction record
   (`interaction-logging-plan.md`) with its decision time.

**Per mode:** the same alarm presentation in all three modes. Only Director
may collapse low levels, as already specified in the C2 spec.

### C — Advice weight per mode

**Problem.** Recommendations show up mainly in the `recommendations-panel`.
The maritime prior art embeds advice *into the instruments*.

**Proposal.**
1. An "advice" category that is visually separate from alarms and
   notifications (its own token and icon).
2. Advice weight per mode (presentation gate):

   | Mode | Weight | Content |
   |---|---|---|
   | Recommendation | `enhanced` | Option **with** a recommendation |
   | Co-Learning | `flat` | **Neutral** options, no ranking |
   | Director | info only | "AI did X", after the fact |

3. In-situ marker on map, ZWL and Zug-Weg diagram at the affected conflict,
   linked to the panel entry (same id, no second source of truth).

**Check against** `recommendation-reliability.md` and `panel-mode-matrix.md`
before mode behaviour changes.

### D — Who has control over this train?

**Problem.** Brief §4.3 proposes `humanControlledAgents`, `takeOverAgent` and
`releaseAgent`. This does not exist yet. The overrides through `setOverride`
are one-shot, and there is no visual language for "human vs. AI in command".

**Proposal.**
1. Implement the state as in brief §4.3. That is a separate brief task, and
   this plan only supplies the UI.
2. Control indicator per train (agents table, inspector, focus tab): who,
   since when, and take/release as an explicit toggle with a confirmation
   step. Every switch is logged as an intervention.
3. Fits in with `agentic-delegation.md` (scope + release).

### E — Brightness palettes — later

Only relevant if studies run in darkened rooms. Then add a third value per
token next to `light-dark()`, with alarm colours checked against
`palettes/critical.md` as a reference (values not copied, contrast measured
ourselves). Until then: no work, just this note.

## 5. Order and effort

| Step | Content | Effort | Depends on |
|---|---|---|---|
| 0 | Entry in `docs/reference/ecosystem.md` (pattern source, licence note) | S | — |
| 1 | B: alarm model + ACK + logging | M | open question 1 |
| 2 | A1+A2: focus contract + focus bar with alarm state | M | 1 |
| 3 | D: control state (brief §4.3) + indicator | M–L | — |
| 4 | C: advice weight + in-situ markers | M | panel-mode-matrix |
| 5 | A3: multi-screen sync | S–M | 2, WP4 need |
| 6 | E: palettes | M | study environment |

B and D bring the most to Director. Step 3 can run in parallel with 1 and 2.

## 6. What could flow back into Lyne

Lyne (`sbb-design-systems/lyne-components`, MIT) has `alert`, `notification`,
`toast`, `status`, `message`, `tabs`, `header` and `sidebar`, all designed for
customer channels. Gaps compared with control-room needs:

| Gap in Lyne | Our building block | Value for Lyne |
|---|---|---|
| Severity levels with an **acknowledgement state** and sort order | B | Any operational SBB application (dispatching, maintenance, operations centre) |
| **Advice** as its own category next to `alert`/`notification` | C | AI support in internal tools |
| **Control status** (human / system in command, handover) | D | Automation in operations, ATO |
| **Context tabs** with a state indicator per object (train, region) | A | Multi-object views |
| A brightness palette beyond light/dark | E | Control rooms with dimmed light |

**Route (deliberately slow):**
1. Build it in our app as Lyne compositions with clean, Lyne-style APIs
   (attributes, events, tokens), with no app logic inside the component.
2. Test it in at least one study run and document the result (§7).
3. Bring it back **through SBB internally first**: present the building blocks and the study evidence internally, and find out
   whether operational SBB applications have the same need and who in the Lyne
   team would own it. Only then open a **discussion** (not a PR) at
   `lyne-components`: the problem, the evidence, the maritime prior art, and
   our implementation as a reference. Lyne's scope is passenger-facing, so
   whether operational patterns belong there at all is SBB's decision. A
   separate "operations" package would be a possible answer.
4. Licensing: what we offer is our own code (Apache 2.0, MIT-compatible) and
   contains no code from the prior art. That keeps the offer clean.

**The other direction:** railway cases (train context bar, control handover
between dispatcher and agent) could be useful to the maritime design system as a design case.
Optional, through their Slack, once A or D runs.

## 7. Success criteria

- B: in a Director run, unacknowledged alarms per train are visible, and the
  ACK time ends up in the record.
- A: switching focus between network and train takes one click, and an alarm
  on a non-focused train stays visible.
- D: in every view it is clear who is in command of a train, and every switch
  is logged.
- C: the same conflict shows a recommendation in Recommendation and neutral
  options in Co-Learning, both in the panel and in-situ, from the same data.
- Give-back: a short evidence summary per building block exists before a Lyne
  discussion is opened.

## 8. Open questions

1. **Naming of severity levels:** does InteractiveAI (FHNW, see local install)
   or `flatland-hmi` use its own criticality levels? If so, use those (AGENTS:
   follow the consortium).
2. **ACK in Recommendation/Co-Learning:** is acknowledging an alarm already an
   "intervention" in the sense of the brief, or a separate event class in the
   record?
3. **Focus bar or tab in the existing shell?** Space on the lab screen is
   limited. Check this against `mode-layouts-three-zones.md`.
4. **Way back into SBB:** in what form does this go to SBB (demo, short
   paper, a list of Lyne gaps with evidence)? And who there talks to the Lyne
   team? Still open.
5. **SBB icons:** with no icon configuration of our own, `sbb-icon` loads its
   icons from the SBB CDN, and their licence is not checked (not covered in
   `design-system.md` yet). Clarify this before new icons for advice and
   control status are added.
6. **Relation to `design-system.md` §7** ("a neutral design system for a
   control room"): this plan is the *pattern* answer and leaves Lyne in
   place. Should the maritime system also be listed there as a candidate system? It
   would be the only one built for control rooms, but its AGPL rules it out as
   a dependency today.

## 9. Non-goals

- No dependency on the prior art and none of its styling.
- No new algorithm: this is presentation and HMI framing only.
- No change to the policy architecture (per-agent policy stays brief §4.4).

## 10. Sources and licence

We learn from **OpenBridge**, the maritime design system for ship bridges and
control rooms (Oslo School of Architecture and Design / OpenBridge Components
AS). Checked on 2026-10-11:

- the case pages <https://www.openbridge.no/cases/integration-system> and
  <https://www.openbridge.no/cases/advice-system>;
- the repo [Ocean-Industries-Concept-Lab/openbridge-webcomponents](https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents)
  (shallow clone of the default branch, v2.x, last push 2026-10-10). Workstream
  sources there: A `src/integration-systems/`, B `src/alert-severity.ts`,
  C `advice-*`, D `command-button` / `command-menu`, E the Day/Dusk/Night/Bright
  palettes and `palettes/critical.md`;
- the Figma file "OpenBridge 6.0 Integration System" needs a login and was
  **not** read.

**Licence:** AGPL-3.0-only; each version also becomes available under Apache 2.0
**180 days** after it is published (`LICENSE.txt`). Hence patterns only, no
code, no `@oicl/*` dependency. Listed as a pattern source in
[`ecosystem.md`](../reference/ecosystem.md).
