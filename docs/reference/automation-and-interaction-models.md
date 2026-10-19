# Automation and Interaction Models

This document compares AI4REALNET, the Flatland UI Hub, the SESAR ATM automation taxonomy, the EASA Concept Paper for Guidance on Artificial Intelligence Applications and the alternative railway reference model Automatic Train Operation (ATO) / Grade of Automation (GoA). SESAR is the primary external reference because it addresses human-machine teaming in air traffic management. It is a conceptual crosswalk, not a claim that the models use identical levels.

## 1. Differences Between the Reference Models

| Model | What is classified? | How are the levels formed? | Why does it differ? |
|---|---|---|---|
| **AI4REALNET** | Collaboration and control allocation between human and AI | The human decides, human and AI work together, or AI acts autonomously | Focus on Human-AI Collaboration, learning, trust and interaction |
| **Flatland UI Hub** | Concrete HMI interaction modes | `Recommendation`, `Co-Learning` and `Director` | Prototype implementation of the AI4REALNET ideas for railway dispatchers |
| **SESAR ATM** | Human roles and automation responsibilities in air traffic management | Enhanced decision-maker, Director, Supervisor and Safeguarder | Focus on human-machine teaming, task delegation, supervision and safety boundaries |
| **EASA Concept Paper for AI Applications** | AI applications in aviation and their human, safety and assurance context | Level 0: Low Automation; Level 1A/1B: Human Assistance; Level 2A: Human-AI Cooperation; Level 2B: Human-AI Collaboration; Level 3A/3B: Advanced Automation | Focus on trustworthy and certifiable AI use, human oversight and assurance |
| **Automatic Train Operation (ATO) / Grade of Automation (GoA)** | Alternative railway reference model for automated train operation and the operational responsibilities assigned at each GoA stage | GoA0: on-sight manual operation; GoA1: manual operation with train protection; GoA2: semi-automatic operation; GoA3: driverless operation with attendant; GoA4: unattended operation | Focus on train operation, staff roles, doors, emergencies and operational safety |
| **Own comparison frame** | Level of automation **and** interaction style in the **Flatland UI Hub** | Five authority levels, crossed with an open set of interaction styles (§5) | A level scale alone cannot tell Recommendation from Co-Learning |

## 2. Comparison Dimensions

| Dimension | AI4REALNET | Flatland UI Hub | SESAR ATM | EASA | Automatic Train Operation (ATO) / Grade of Automation (GoA) |
|---|---|---|---|---|---|
| **Unit of analysis** | Human-AI system | Dispatcher HMI and AI | ATM human-machine team | Pilot and flight-control system | Train and railway operation |
| **Main question** | Who decides and how do human and AI collaborate? | How is this collaboration implemented in the HMI? | Which tasks are allocated to the human or automation, and who supervises? | Which flight functions does automation perform? | Who operates the train and who is on board? |
| **Human role** | Decision-maker, learning partner or supervisor | Dispatcher as decision-maker, learning partner or supervisor | Enhanced decision-maker, Director, Supervisor or Safeguarder | Pilot actively controls or supervises | Driver, attendant or no staff on board |
| **Highest level** | AI acts autonomously while the human supervises | Director with `aiInControl` and override | Safeguarder: system operates autonomously within defined boundaries and can return control to the human | No direct EASA LoA equivalent; the Concept Paper focuses on AI assistance, collaboration, oversight and assurance | GoA4: unattended automatic operation |
| **Primary dimension** | Collaboration and decision allocation | HMI interaction mode | ATM function allocation and human oversight | Technical flight automation | Automation of railway operation |

## 3. Interaction Modes in the Flatland UI Hub

| Interaction mode | Description | Human role |
|---|---|---|
| **Recommendation** | The AI analyses the situation and recommends a concrete option | The human decides whether to accept or reject the recommendation |
| **Co-Learning** | The AI presents neutral options and supports reflection | The human chooses, acts and learns together with the AI |
| **Director** | The AI executes the operational process largely autonomously | The human sets goals, supervises and can intervene |

The modes are experiment conditions and interaction presets. They are not three consecutive automation levels: §5 separates the level of automation from the interaction style, and the modes are combinations of the two.

## 4. Two Independent Axes

The current concept separates two questions that are often conflated:

### Axis A: autonomy and function allocation

Who performs the functions of monitoring, generating, selecting and implementing?

### Axis B: collaboration goal

What is the interaction intended to achieve?


The resulting mapping is:

| Interaction mode | Autonomy/function allocation | Collaboration goal | Distinguishing feature |
|---|---|---|---|
| **Recommendation** | Advisory / decision support | Perform | Options are ranked or one option is explicitly recommended |
| **Co-Learning** | Advisory / decision support | Co-learn | Options are presented neutrally and followed by reflection or what-if comparison |
| **Director** | Supervised or partly autonomous | Perform | AI generates, selects and implements the plan; the human sets goals and supervises |

Recommendation and Co-Learning therefore sit at approximately the same function-allocation level. Their difference is the collaboration goal and the framing of options, not necessarily the amount of automation.

## 5. Three Terms, Kept Apart

The comparison only works if three things are not merged into one scale. A
single "level" ladder that runs from manual control through Co-Learning and
Recommendation to Director mixes them and produces contradictions: §4 places
Recommendation and Co-Learning at the same function allocation, while a ladder
must put one above the other.

| Term | Question it answers | Values today | Is it a level? |
|---|---|---|---|
| **Level of automation (authority)** | Who monitors, generates options, selects and implements? The four functions are the information-processing stages of Parasuraman, Sheridan & Wickens (2000); each can be automated to a different level. | Manual · information support · advisory (human selects) · supervised execution (AI selects and implements, human intervenes) | **Yes.** The only axis where SESAR, EASA and GoA comparisons apply. |
| **Interaction style** | How is the human-AI interaction designed? What is it for? | **Recommendation**: the AI advises with a preferred option and a rationale; the human accepts or rejects. **Co-Learning**: the interaction is designed so that *both sides* learn: neutral options, reflection, what-if, feedback in both directions. **Directive**: the human steers through goals and directives rather than single decisions. | **No.** An open set of ways to interact, not a ranking. Further styles are conceivable (see below). |
| **Experiment condition** (`InteractionMode`) | Which combination does a session run? | `recommendation`, `co-learning`, `director` | **No.** A named point in the space above, chosen to be comparable in a study. |

Read this way, the three current modes are three cells of a two-dimensional
space, not three steps:

- `recommendation` = advisory authority × Recommendation style
- `co-learning` = advisory authority × Co-Learning style
- `director` = supervised execution × Directive style

The repository already points the same way. [`interaction-mode-axes.md`](interaction-mode-axes.md)
separates the two axes, and [`colearning-across-modes.md`](../plans/colearning-across-modes.md)
treats Co-Learning as a cross-cutting layer rather than a fourth mode. That plan
still draws the three modes on one line from full human control to full AI
control; it should be read against this section.

### Which styles are possible at which level

Interaction style is largely independent of the level of automation. Only at
the edges do some interactions stop being possible:

| Level of automation | Recommendation | Co-Learning | Directive |
|---|---|---|---|
| **Manual** (human does everything) | ✕ nothing to recommend | ◐ the human learns from feedback and replay; the AI can only observe | ✕ nothing to direct |
| **Information support** (AI analyses, human generates and selects) | ◐ hints, no concrete option | ✓ | ✕ |
| **Advisory** (AI generates options, human selects) | ✓ **`recommendation`** | ✓ **`co-learning`** | ◐ goals constrain which options are generated |
| **Supervised execution** (AI selects and implements, human can intervene) | ◐ the AI announces what it will do; the human vetoes | ✓ *not expressible today*: learning from interventions, directives and the debrief | ✓ **`director`** |
| **Unattended** (no ongoing supervision) | ✕ | ✕ during operation | ✕ |

✓ possible · ◐ possible in a reduced form · ✕ not possible.
The unattended row lies outside the AI4REALNET and Flatland UI Hub concept and
is listed only for the GoA4 comparison.

The empty middle cells are the research space: the same authority with a
different interaction style (does Co-Learning change decision quality, learning
and trust compared with Recommendation?), and the same style at a different
authority (does Co-Learning still work when the AI executes?).

### Other interaction styles

The list of styles is deliberately open. Candidates that fit the same
definition, not decided or built:

- **Critique / devil's advocate**: the human proposes, the AI challenges the proposal with risks and counter-examples.
- **Explanation on demand**: the AI stays silent until asked, then explains the situation or an option.
- **Negotiation**: human and AI exchange constraints (for example a priority order, as the PP contention strategy already does) until both accept a plan.
- **Teaching / demonstration**: the human shows a solution; the AI generalises it into a rule it later proposes.

Each would be a further interaction style, combinable with more than one level,
not a further rung on a ladder.

### What "both sides learn" means today

On the human side, Co-Learning is built: neutral options, reflection, what-if
compare, learning cards and rules that the human formulates and checks in the
sandbox. On the AI side, `LearningStore` records confirmed preferences
together with the situation they apply to, but nothing feeds them back into the
ranking or the planner yet ("no ranking feedback", Tier 2 in
`docs/plans/workstream-b-rationale-capture.md`). Until that loop is closed,
Co-Learning in the hub is human learning with the AI as a partner, and the
AI-side learning is a stated goal.

## 6. Crosswalk to the Reference Models (authority axis only)

The following mapping is approximate and compares **only the level of
automation**, the degree of human involvement in monitoring, generating,
selecting and implementing. Interaction styles have no counterpart in these
taxonomies and are deliberately left out.

### Per function, not per system

Parasuraman, Sheridan & Wickens (2000) ("A model for types and levels of human
interaction with automation", IEEE Trans. SMC-A 30(3), 286–297,
[doi:10.1109/3468.844354](https://doi.org/10.1109/3468.844354)) split
automation into four functions: information acquisition, information analysis,
decision and action selection, and action implementation. Each function has
its own level, so a system has a *profile*, not one level. The EUROCONTROL /
SESAR **Level of Automation Taxonomy (LOAT)**, from SESAR project 16.05.01
(Save & Feuerberg), builds on this with one column of levels per function. It
is the finer SESAR reference for this crosswalk than the four SESAR human
roles used in the table below.

The hub's modes as profiles, from [`interaction-mode-axes.md`](interaction-mode-axes.md) §1
(H = human, C = computer, H/C = shared):

| Mode | Information acquisition (monitoring) | Information analysis (generating options) | Decision and action selection | Action implementation |
|---|---|---|---|---|
| `recommendation` | H/C | H/C | **H** | C |
| `co-learning` | H/C | H/C | **H** | C |
| `director` | H/C | C | C | C |

The two advisory modes have the same profile. Director differs in two of four
columns, not in "one level". A LOAT assessment would assign a level per column;
that has not been done here and would need the LOAT definitions at hand (they
were not available when this section was written).

The table below compresses these profiles into one row per level so that the
whole-system taxonomies (SESAR roles, EASA, GoA) can be compared at all.

| Level of automation | AI4REALNET | Flatland UI Hub | SESAR ATM | EASA | Automatic Train Operation (ATO) / Grade of Automation (GoA) |
|---|---|---|---|---|---|
| **Manual** | Full Human Control | Manual control | Enhanced decision-maker (level 1), without automation support | Outside the paper's AI-level comparison | GoA0 |
| **Information support** | Analysis and KPI support | Analysis, KPIs and hints | Enhanced decision-maker (level 1), automation provides overview and solution space | Level 1A/1B: human assistance; conceptual analogy | GoA1 |
| **Advisory** | AI-assisted Human Control and Human-AI Co-Learning | `recommendation` **and** `co-learning` | Director (level 2): automation calculates or proposes, human decides | Level 1B to 2A/2B, depending on how much of the selection is shared; conceptual analogy | GoA1–GoA2 as a broad analogy |
| **Supervised execution** | Fully Autonomous AI Control with human supervision | `director` / `aiInControl` | Supervisor (level 3) or Safeguarder (level 4), depending on whether the human allocates tasks or only supervises | Level 3A: advanced automation safeguarded by the human; conceptual analogy | GoA3, with GoA4 as the closest higher-autonomy comparison |
| **Unattended** | Not provided | Not available | Beyond the four SESAR human-role levels | No direct equivalent | GoA4: unattended operation |

AI4REALNET's own three-point line (Full Human Control → Co-Learning → Full
AI-Based Control) names Co-Learning as its middle point. In this crosswalk it
sits on the advisory row together with Recommendation, because both leave the
selection with the human; the difference between them is the interaction style
(§5), not the authority. SESAR's Safeguarder (level 4) is not the same as the
Flatland UI Hub's Director: the names describe different role concepts.

## 7. Main Conclusion

The models do not measure the same dimension:

```text
AI4REALNET     -> collaboration and decision allocation
Flatland UI Hub -> HMI interaction mode
SESAR ATM      -> ATM function allocation and human oversight
EASA           -> AI assistance, Human-AI Collaboration, oversight and assurance
Automatic Train Operation (ATO) / Grade of Automation (GoA) -> automated railway operation and its operational GoA stages
```

The own frame (§5) is a comparison bridge for the Flatland UI Hub: its authority axis lines up with the reference models, its interaction-style axis has no counterpart in them. It does not replace the reference models. SESAR is the closest external conceptual reference for the Flatland UI Hub because both describe human roles, delegation and supervision in an operational control environment. The EASA Concept Paper is included as an aviation AI assurance and human-oversight reference; it is not a GoA-style automation scale. Flatland UI Hub `Director`, SESAR `Safeguarder` and railway `GoA4` can be comparable in terms of human supervision, but they describe different systems, tasks and safety responsibilities.

The most important conceptual distinction is:

```text
Interaction Mode != Level of Automation
```

`Recommendation` and `Co-Learning` can use the same advisory function allocation while differing in collaboration goal and option presentation. `Director` moves the allocation towards supervised or autonomous execution.

## 8. Mapping the Reference Models to the EASA AI Concept Paper

The EASA Concept Paper provides the common comparison frame for this document. The following mapping is approximate: EASA classifies AI applications in aviation, while AI4REALNET, the Flatland UI Hub, SESAR ATM and the alternative ATO/GoA railway reference model classify collaboration, operational roles or railway automation. The mapping therefore identifies the closest EASA concept and does not claim that the systems have equivalent safety responsibilities.

| Reference model | Closest EASA Concept Paper level | Mapping rationale | Important limitation |
|---|---|---|---|
| **AI4REALNET** | Level 1B to Level 3A, depending on the mode and authority delegated to AI | Spans human-supported decisions, human-AI cooperation or collaboration, and supervised AI execution | AI4REALNET is a collaboration and control-allocation model, not an aviation AI certification taxonomy |
| **Flatland UI Hub** | `Recommendation` and `Co-Learning`: the same band, Level 1B to 2A/2B; `Director`: Level 2B to Level 3A | Both advisory modes leave the selection with the human and differ in interaction style, which EASA does not classify; Director can delegate selection and implementation while the human supervises | The exact level depends on which functions the Director executes and how much authority is delegated |
| **SESAR ATM** | Enhanced decision-maker: Level 1B; Director: Level 2A/2B; Supervisor or Safeguarder: Level 3A | EASA's assistance, cooperation, collaboration and safeguarded advanced automation concepts provide the closest functional analogies | SESAR defines ATM human roles and responsibility boundaries, not generic AI application levels |
| **Automatic Train Operation (ATO) / Grade of Automation (GoA)** | GoA0/GoA1: Level 0 to Level 1B; GoA2: Level 2A; GoA3: Level 2B to Level 3A; GoA4: closest to Level 3A/3B | Increasing train-operation automation can be compared with increasing AI authority and decreasing direct human involvement | GoA classifies railway operating staff and train functions; EASA Level 3 classifies AI authority and oversight in aviation |
| **EASA Concept Paper** | Level 0, Level 1A/1B, Level 2A/2B and Level 3A/3B | This is the source taxonomy used as the comparison reference in this section | The Concept Paper is aviation-specific and should not be treated as the official taxonomy of the other models |

## 9. Gaps and Discussion Points for the Flatland UI Hub

The comparison exposes several open points for the Flatland UI Hub. These are not all implementation defects. Some are research and governance questions that should be decided before the interaction modes are treated as validated automation levels.

| Area | Current gap | Discussion point | Suggested next clarification |
|---|---|---|---|
| **Authority allocation** | `Director` is mapped between EASA Level 2B and Level 3A | Which functions may the AI monitor, generate, select and implement? | Define the authority boundary per function and scenario, including who can revoke it |
| **Recommendation vs Co-Learning** | Both can use an advisory function allocation | Is the difference only the collaboration goal, or does Co-Learning also change the AI's permitted actions? | Specify the invariant autonomy level and the mode-specific collaboration behaviour |
| **Mode-to-level mapping** | The three modes are not fixed EASA or GoA levels | Can one mode move between EASA analogies depending on scenario, policy or task? | Store the mapping as an explicit experiment configuration rather than presenting it as a universal equivalence |
| **Adjustable autonomy** | Policy is global per session and the Director's authority boundary is not yet expressed as a user-facing control | Should autonomy be adjustable by scenario, task, agent or operational phase? | Decide whether a single session policy is sufficient and define the allowed transitions |
| **Safety envelope and handback** | The conditions for entering, degrading and leaving Director operation need a formal boundary | What happens when observations are stale, uncertainty rises, a conflict is detected or the AI becomes unavailable? | Define preconditions, fallback behaviour, human handback and recovery evidence |
| **Responsibility and audit trail** | The conceptual model does not yet specify the complete decision record | Which AI proposal, policy, human action, override and system state must be reconstructable? | Define an event schema for recommendation, acceptance, rejection, execution, override and outcome |
| **Uncertainty and explanation** | Recommendations and autonomous actions need a comparable confidence and rationale representation | What must the dispatcher see before accepting a recommendation or supervising Director execution? | Agree on uncertainty, alternatives, constraint violations, rationale and known limitations |
| **Human factors** | The mapping does not yet demonstrate effects on workload, situation awareness, trust or automation bias | Which measures show that Co-Learning is genuinely reflective and that Director remains supervisable? | Define study hypotheses and measures such as workload, trust calibration, intervention quality and recovery time |
| **Operational design domain** | The modes are described independently of explicit scenario boundaries | In which traffic density, malfunction, timetable and infrastructure conditions is each mode valid? | Attach an operational design domain and exclusion conditions to every experiment configuration |
| **Assurance and learning** | The EASA Concept Paper highlights assurance, learning assurance and monitoring, but these are not yet mapped to Flatland artefacts | How are model changes, drift, retraining and unsafe behaviour detected and approved? | Define data provenance, offline evaluation, regression gates, monitoring and rollback responsibilities |
| **Cross-domain claims** | EASA, SESAR and ATO/GoA use different units of analysis | Which statements are illustrative analogies and which are intended as research claims? | Mark every crosswalk as analogy, define its evidence basis and avoid normative equivalence |

The most important unresolved question is whether `Director` is intended to represent EASA Level 2B, safeguarded Level 3A, or a configurable range between them. The answer depends on whether the human retains final authority over every action, whether the AI may implement actions without confirmation, and whether remote supervision is sufficient. Until this is specified, `Director` should remain a behaviourally defined experiment mode rather than a fixed automation level.

## 10. Consolidated Discussion from the Repository References

The other reference documents converge on one central interpretation: the Flatland UI Hub `InteractionMode` is an interaction contract that also carries an automation implication, but it is not a complete automation taxonomy. The distinction matters because the same automation level can support different collaboration goals, while the same mode can require different authority boundaries in different scenarios.

| Repository reference | Consolidated finding | Consequence for Interaction Mode and automation |
|---|---|---|
| [Interaction mode axes](interaction-mode-axes.md) | `InteractionMode` currently carries two axes: autonomy/function allocation and collaboration goal | Do not read the three modes as one linear scale; Recommendation and Co-Learning can share advisory autonomy, while Director spans supervised to partly autonomous execution |
| [Interaction modes brief](interaction-modes-brief.md) | Recommendation means ranked advice, Co-Learning means neutral options plus reflection, and Director means autonomous action under a high-level directive | Mode semantics must be behaviourally distinct at runtime; labels alone are not enough |
| [Interaction framework](interaction-framework.md) | Recommendation is a framing of decision support, Co-Learning is assessment and learning, and Director suppresses ordinary decision prompts because the AI acts | The UI must expose the collaboration contract without falsely presenting every difference as a new automation level |
| [Panel-mode matrix](panel-mode-matrix.md) | The interaction mode is the single source of truth for panel availability and presentation | Every widget must implement the same mode semantics; parallel mode flags or inconsistent panel behaviour would invalidate the experiment conditions |
| [Director mode reference](director-mode.md) | Director changes policy, accepts a directive, plans actions and can replay or override a committed plan | Director needs an explicit authority contract, handback rule, audit trail and failure boundary before it can be treated as advanced automation |
| [Flatland overview](OVERVIEW.md) | The three modes are the core product concept and are presented as distinct runtime workflows | The experiment sequence should compare collaboration behaviour and human responsibility, not imply that Recommendation, Co-Learning and Director are universal EASA or GoA levels |

The consolidated model is therefore two-dimensional:

```text
Automation / authority axis:
human control -> information support -> cooperation/collaboration -> safeguarded advanced automation

Interaction contract axis:
ranked recommendation -> neutral co-learning -> directive-based supervision
```

The two axes meet in the current modes as follows:

| Flatland UI Hub mode | Interaction contract | Automation interpretation | Main discussion |
|---|---|---|---|
| **Recommendation** | The AI ranks or highlights an option; the human decides | Advisory: EASA Level 1B to 2A/2B, the same band as Co-Learning | How much explanation, confidence and consequence information does the human need to make an informed decision? |
| **Co-Learning** | The AI presents neutral alternatives; the human decides, reflects and runs what-if comparisons | Advisory: the same band as Recommendation; the difference is the interaction style, not the authority | How do we prove that neutrality and reflection change learning rather than only the visual framing? |
| **Director** | The human sets goals; the AI plans and acts while the human supervises | EASA Level 2B to safeguarded Level 3A, depending on delegated authority | Which decisions can the AI implement without confirmation, and what evidence shows that the human can still intervene effectively? |

This synthesis gives the Flatland UI Hub a precise position: it is primarily an HMI and human-AI collaboration model, with automation expressed through the authority granted to each mode and scenario. The research contribution is therefore not to create a fourth automation taxonomy, but to test how different interaction contracts affect decision quality, learning, workload, trust calibration and safe supervision at comparable or explicitly changing authority levels.

## Related Repository References

- [Interaction modes brief](interaction-modes-brief.md)
- [Interaction mode axes discussion paper](interaction-mode-axes.md)
- [Interaction framework](interaction-framework.md)
- [AI4REALNET and ecosystem references](ecosystem.md)
- [Automatic Train Operation (ATO) and Grade of Automation (GoA)](https://de.wikipedia.org/wiki/Automatic_Train_Operation)
- [EASA Concept Paper: Guidance for Artificial Intelligence Applications, Proposed Issue 03](https://www.easa.europa.eu/sites/default/files/dfu/easa_concept_paper_guidance_for_artificial_intelligence_applications_proposed_issue_03.pdf)
- [SESAR European ATM Master Plan 2025, A.3 Automation roadmap](https://www.sesarju.eu/node/4820)
