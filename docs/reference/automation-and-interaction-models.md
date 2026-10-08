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
| **Own comparison scale** | Comparable automation in the **Flatland UI Hub** | From human decision-making to autonomous AI execution | Simplified synthesis for comparing the different models |

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

The modes are experiment conditions and interaction presets. They should not automatically be interpreted as three consecutive automation levels.

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

## 5. Own Comparison Scale for the Flatland UI Hub

This five-level scale is a comparison aid for the Flatland UI Hub. It is not an official AI4REALNET, SESAR, EASA or GoA scale.

| LoA | Description | Primary function |
|---:|---|---|
| **1** | Human observes, decides and acts completely independently | Manual Control |
| **2** | The system analyses the situation and informs the human | Information Support |
| **3** | The system generates several neutral options; the human selects one | Collaborative Decision Making |
| **4** | The system recommends a preferred option; the human confirms or rejects it | Recommendation |
| **5** | The system executes autonomously; the human supervises and can intervene | Supervisory Control |

A fully autonomous operation without ongoing human supervision is not currently part of the Flatland UI Hub or AI4REALNET concept. A sixth row may be used only as an external comparison extension for GoA4.

## 6. Crosswalk to the Reference Models

The following mapping is approximate. It compares the degree of human involvement, not identical technical functions.

| Own comparison level | AI4REALNET | Flatland UI Hub | SESAR ATM | EASA | Automatic Train Operation (ATO) / Grade of Automation (GoA) |
|---:|---|---|---|---|---|
| **1** | Full Human Control | Manual Control | Enhanced decision-maker (level 1) | Outside the paper's AI-level comparison | GoA0 |
| **2** | Analysis and KPI support | Analysis, KPIs and hints | Enhanced decision-maker (level 1), with automation providing the overview and solution space | Level 1B: Human support in decision and action selection; conceptual analogy | GoA1 |
| **3** | Shared Human-AI Co-Learning | Co-Learning | Director (level 2) as a partial analogy: human evaluates options and has the final say | Level 2A: Human-AI cooperation; conceptual analogy | GoA1-GoA2 |
| **4** | AI-assisted Human Control / Recommendation | Recommendation Mode | Director (level 2) as the closest role analogy: automation calculates or proposes, human decides | Level 2B: Human-AI collaboration; conceptual analogy | GoA2 as a broad operational analogy |
| **5** | Fully Autonomous AI Control with human supervision | Director / `aiInControl` | Supervisor (level 3) or Safeguarder (level 4), depending on whether the human allocates tasks or only supervises autonomous operation | Level 3A: Advanced automation safeguarded by the human; conceptual analogy | GoA3, with GoA4 as the closest higher-autonomy comparison |
| **6** | Not provided | Not available | Beyond the four SESAR human-role levels in this crosswalk | No direct equivalent | GoA4: unattended operation |

Level 6 is not part of the own Flatland UI Hub scale. It is included only so that GoA4 can be shown in the comparison. SESAR's Safeguarder (level 4) is not the same as the Flatland UI Hub's Director: the names describe different role concepts.

## 7. Main Conclusion

The models do not measure the same dimension:

```text
AI4REALNET     -> collaboration and decision allocation
Flatland UI Hub -> HMI interaction mode
SESAR ATM      -> ATM function allocation and human oversight
EASA           -> AI assistance, Human-AI Collaboration, oversight and assurance
Automatic Train Operation (ATO) / Grade of Automation (GoA) -> automated railway operation and its operational GoA stages
```

The own scale is a comparison bridge for the Flatland UI Hub. It does not replace the reference models. SESAR is the closest external conceptual reference for the Flatland UI Hub because both describe human roles, delegation and supervision in an operational control environment. The EASA Concept Paper is included as an aviation AI assurance and human-oversight reference; it is not a GoA-style automation scale. Flatland UI Hub `Director`, SESAR `Safeguarder` and railway `GoA4` can be comparable in terms of human supervision, but they describe different systems, tasks and safety responsibilities.

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
| **Flatland UI Hub** | `Recommendation`: Level 1B; `Co-Learning`: Level 2A; `Director`: Level 2B to Level 3A | Recommendation supports human decision-making; Co-Learning is cooperative; Director can delegate selection and implementation while the human supervises | The exact level depends on which functions the Director executes and how much authority is delegated |
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
| **Recommendation** | The AI ranks or highlights an option; the human decides | Usually EASA Level 1B / advisory decision support | How much explanation, confidence and consequence information does the human need to make an informed decision? |
| **Co-Learning** | The AI presents neutral alternatives; the human decides, reflects and runs what-if comparisons | Usually EASA Level 2A / human-AI cooperation, but not necessarily more autonomous than Recommendation | How do we prove that neutrality and reflection change learning rather than only the visual framing? |
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
