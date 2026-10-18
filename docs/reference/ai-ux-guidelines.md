# AI UX guidelines — HAX and Fluent 2 against the hub

Status: reference, 2026-10-18. A checklist, not a spec: it says which
established human-AI design guidelines the hub meets per interaction style,
where it does not, and where a guideline collides with the study design.

## Sources and how far they were checked

| Source | What it is | Checked |
|---|---|---|
| **Guidelines for Human-AI Interaction** (Amershi et al., CHI 2019, [doi:10.1145/3290605.3300233](https://doi.org/10.1145/3290605.3300233)); the basis of Microsoft's [HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/) | 18 guidelines in four phases, validated with 49 practitioners against 20 products | **Yes.** Wording below is from Table 1 of the paper. |
| **Fluent 2** (fluent2.microsoft.design) and Microsoft's UX guidance for generative AI / Copilot | Design system and pattern guidance, including AI-specific patterns | **No.** Neither site was reachable from the environment this was written in. §4 lists the patterns as candidates to verify, not as quotations. |

**The stack stays.** Frontend rules (AGENTS.md) keep Angular + SBB Lyne. What
is taken from Fluent or HAX is patterns and guidance, never components or
tokens.

The interaction styles are those of
[`automation-and-interaction-models.md`](automation-and-interaction-models.md)
§5: **Recommendation** (`recommendation`), **Co-Learning** (`co-learning`),
**Directive** (`director`). Status comes from reading the code and
[`panel-mode-matrix.md`](panel-mode-matrix.md), not from a test in the running
app.

Legend: ✓ met · ◐ partly · ✕ missing · — not applicable to this style.

## 1. The 18 guidelines against the hub

### Initially

| # | Guideline | Recommendation | Co-Learning | Directive | Where in the hub / gap |
|---|---|---|---|---|---|
| G1 | **Make clear what the system can do.** | ◐ | ◐ | ◐ | Mode intro (`mode-intro`), tour briefings and the Algorithm Gallery (`#/algorithms`, now covering every seam). In the working screen, nothing says what *this* AI can do in *this* setup (which algorithm, which levers). |
| G2 | **Make clear how well the system can do what it can do.** | ✓ | ✓ neutral per option | ◐ read-only | `risk-uncertainty` (A1): calibrated reliability per AI output. The backend uncertainty is ensemble-based and "not yet calibrated" (the component says so). In Directive, how well the *plan* will hold is not shown as one figure. |

### During interaction

| # | Guideline | Recommendation | Co-Learning | Directive | Where in the hub / gap |
|---|---|---|---|---|---|
| G3 | **Time services based on context.** | ✓ | ✓ | ✓ | Auto-pause on conflict (`autoPauseOnConflict`), the conflict-window prompt (E1), the reflection prompt "when calm". Adaptive tempo (smooth-playback item 4) would complete it. |
| G4 | **Show contextually relevant information.** | ✓ | ✓ | ✓ | Triaged event feed (C2), situation summary, the map and Zug-Weg showing the conflict the options answer. |
| G5 | **Match relevant social norms.** | ✓ | ✓ | ✓ | Swiss German with the informal *du* and railway vocabulary (i18n rules). The terminology work in #113 (Betriebsszenario, Betriebsstörung) serves this. |
| G6 | **Mitigate social biases.** | — | — | — | No people are classified. The nearest analogue is fairness between trains or operators in a priority order; not a current requirement. |

### When wrong

| # | Guideline | Recommendation | Co-Learning | Directive | Where in the hub / gap |
|---|---|---|---|---|---|
| G7 | **Support efficient invocation.** | ◐ | ✓ | ◐ | Co-Learning: what-if compare (B1) on demand. Recommendation: the recommendations arrive on their own; asking the AI about a train the human picked is only partly possible (train strip on the map). Directive: re-plan on demand via goal weights. |
| G8 | **Support efficient dismissal.** | ✓ | ✓ | ◐ | Reject in the recommendations panel, dismiss in the triaged feed and the prompts. In Directive the human cannot dismiss a single AI action, only take over. |
| G9 | **Support efficient correction.** | ✓ | ✓ | ◐ | Overrides (`setOverride`) and the "why?" capture on override. Directive: the take-over lever and directives; correcting one train inside a committed plan is coarse. |
| G10 | **Scope services when in doubt.** | ◐ | ◐ | ✓ | Director: "a train it cannot route holds rather than guessing". In the advisory styles a low-confidence recommendation is still shown as a recommendation; it is not offered as "several options" instead. |
| G11 | **Make clear why the system did what it did.** | ✓ | ✓ | ✓ | WHY column on the strategy cards, `at_conflict` texts, `ai-activity` ("Was die KI macht"), `director-divergence` (B6: who changes and how). |

### Over time

| # | Guideline | Recommendation | Co-Learning | Directive | Where in the hub / gap |
|---|---|---|---|---|---|
| G12 | **Remember recent interactions.** | ✓ | ✓ | ✓ | Decision log (A2), learning records, shift review. |
| G13 | **Learn from user behavior.** | ✕ | ✕ | ✕ | `LearningStore` records confirmed preferences with their situation, but nothing feeds them back into ranking or planning ("no ranking feedback", Tier 2 in `docs/plans/workstream-b-rationale-capture.md`). This is the AI side of "both sides learn". **Collides with the study design, see §2.** |
| G14 | **Update and adapt cautiously.** | — | — | ◐ | Director: a residual re-plan is spliced in only when it out-scores continuing the committed plan. Becomes relevant to the advisory styles once G13 exists. |
| G15 | **Encourage granular feedback.** | ◐ | ✓ | ◐ | Co-Learning: reflection, rule builder, learning cards. Recommendation: feedback only on override ("why?"), not on an accepted recommendation. Directive: goal weights are the feedback; there is no feedback per AI action. |
| G16 | **Convey the consequences of user actions.** | ◐ | ✓ | ◐ | Co-Learning shows consequences through what-if and the Co-Learning effect. That a human action changes *future AI behaviour* cannot be shown yet, because it does not (G13). |
| G17 | **Provide global controls.** | ◐ | ◐ | ✓ | Director: goal weights, take-over. Settings for auto-pause and smooth motion exist. The human cannot globally limit what the AI monitors or proposes. **Partly in tension with fixed conditions, see §2.** |
| G18 | **Notify users about changes.** | ✕ | ✕ | ◐ | Director: `ai-activity` reports re-plans. Nothing tells the human that an algorithm, model or ranking changed between sessions or shifts. |

## 2. Where a guideline collides with the study design

The hub is an experiment platform. Some guidelines assume a product that
adapts to its user; an experiment needs comparable, fixed conditions.

- **G13 / G14 / G16, learning from the user.** An AI that adapts to each
  participant changes the condition during the study. If AI-side learning is
  built, it has to be an explicit part of the condition (for example only in
  Co-Learning, or only between shifts) and logged, so that "the AI learned"
  is a measured effect rather than noise.
- **G17, global controls.** Letting the participant switch what the AI does
  would let them leave their condition. Global controls belong to the
  experimenter (setup and condition), not to the participant, unless the
  control itself is what is studied (adjustable autonomy in Directive).
- **G2, showing reliability.** Whether, and how, confidence is shown is part
  of the manipulation between Recommendation (ranked, with confidence) and
  Co-Learning (neutral per option). Meeting G2 identically in every style
  would erase a difference the study needs.
- **G10, scoping in doubt.** Falling back from one recommendation to several
  neutral options when uncertain would turn Recommendation into Co-Learning
  for those moments. If wanted, it must be logged as a style switch.

These are not reasons to ignore the guidelines, but to place each one
deliberately: per style, in the condition definition, and in the log.

## 3. Gaps worth closing, in order

1. **G15 in Recommendation, feedback on an accepted recommendation.** Today
   only an override asks "why?". A light thumbs-up or thumbs-down with an
   optional reason closes the capture side of "both sides learn" without
   changing what the AI does, so it does not collide with §2.
2. **G1 in the working screen, "what this AI does here".** One line per
   setup naming the active algorithm (from the catalog), its seam and its
   lever. Cheap, and it serves comparability: participants know what they
   are working with.
3. **G18 between shifts.** When a model, algorithm or ranking differs from the
   previous shift, say so. A prerequisite for making G13 visible later.
4. **G10 in the advisory styles.** Decide (§2) whether low confidence should
   ever widen a recommendation into options. Either way, log it.
5. **G13, AI-side learning.** The largest item and a design decision first
   (§2). It belongs in the Co-Learning plan, not here.

## 4. Fluent 2 and Copilot patterns, to verify

These are patterns Microsoft's AI design guidance is known for. They were
**not** checked against the current Fluent 2 or Microsoft Learn pages (not
reachable when this was written). Verify before citing them.

| Pattern (to verify) | Relates to | In the hub |
|---|---|---|
| Label AI-generated content visibly, with a note that it can be wrong | G2, G11 | Plan / KI / Mensch columns separate sources; whether every AI output is marked as such across widgets has not been audited. |
| References or evidence beside an AI answer | G11 | WHY column, `at_conflict`, divergence list. |
| Feedback controls right on the AI output | G15 | See §3 item 1. |
| Visible AI states: working, done, uncertain, failed | G2, G3 | PP and the Director plan take seconds; a uniform "the AI is computing / could not plan" state is worth checking. |
| Progressive disclosure: the short answer first, details on request | G4, G11 | Collapsed rows in the catalogs, expandable cards; not a stated rule for every widget. |
| Compact density for data-heavy screens | (layout) | Lyne is built for customer-facing screens; a dispatcher HMI is denser. Any density rule stays in our token layer. |

## Related

- [`automation-and-interaction-models.md`](automation-and-interaction-models.md): level of automation versus interaction style
- [`interaction-modes-brief.md`](interaction-modes-brief.md): the authoritative mode spec
- [`panel-mode-matrix.md`](panel-mode-matrix.md): what each widget does per mode
- [`interaction-framework.md`](interaction-framework.md): widget taxonomy and function allocation
