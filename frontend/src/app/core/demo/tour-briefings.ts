/**
 * Tour briefings — the opening and closing pages a tour can wrap around its
 * modes. Content only; rendered by `features/tour-briefing`. A tour opts in via
 * `Tour.briefingId`.
 *
 * The first briefing frames the expert interviews for the CAS thesis "Evaluating
 * AI-Based Co-Learning Extensions for Railway Traffic Management Using Monte
 * Carlo Simulation" (D. Boos, iimt / Uni Fribourg). Module list, Kolb mapping and
 * the two loops follow that thesis' Tables 1 and 2.
 */

import { InteractionMode } from '../events/event-types';
import { ModeIntro } from './mode-intro-configs';

export interface BriefingSection {
  heading: string;
  body?: string;
  items?: string[];
  ordered?: boolean;
}

export type ModuleStatus = 'live' | 'partial' | 'concept';

export interface BriefingModule {
  name: string;
  area: string;
  kolbPhase: string;
  does: string;
  inTour: string;
  status: ModuleStatus;
  statusNote: string;
}

export interface KolbPhase {
  name: string;
  supported: boolean;
  note: string;
}

export interface LoopStep {
  actor: string;
  action: string;
}

export type GuideStepId =
  | 'detect'
  | 'assess'
  | 'alternatives'
  | 'decide'
  | 'execute'
  | 'reflect'
  | 'shift-summary'
  | 'event-simulation'
  | 'ai-learns';

export type GuideLoop = 'operational' | 'learning';

/** One step of the tour's interaction flow, shown in the guide strip. */
export interface TourGuideStep {
  id: GuideStepId;
  loop: GuideLoop;
  title: string;
  /** What to do or look at while this is the current step. */
  hint: string;
  /** Panel to highlight while this step is current. */
  panelType?: string;
  /** A Co-Learning module, as opposed to the TMS base. */
  module?: boolean;
  /** Takes place after the episode (sandbox); never ticked during the run. */
  afterEpisode?: boolean;
}

export interface TourBriefing {
  id: string;
  /** The interaction flow as a checklist that ticks itself during the run. */
  guide?: TourGuideStep[];
  /** After the shift, show the tour debrief (steps 7-9) instead of the Director review. */
  debrief?: boolean;
  /** Run the tour under a fresh operator id, so interviewees never inherit each other's preferences. */
  freshOperatorProfile?: boolean;
  /** Pause after a decision and ask "why?" in a dialog instead of only in the reflection panel. */
  reasonDialog?: boolean;
  /**
   * Keep the impact panel to the assessment and leave the options to the
   * proposals panel — the split of thesis Table 1, where "Risk & Impact
   * Assessment" and the "Alternatives Module" are two modules. Off elsewhere, so
   * the study conditions keep the panel that decides and assesses in one place.
   */
  assessmentOnly?: boolean;
  /**
   * The app language while this tour runs. Tour-owned text keeps its own
   * language, but the panels follow the app setting — without this a German
   * tour started from the English default shows a mix. The previous language
   * comes back when the tour ends.
   */
  language?: 'en' | 'de' | 'fr';
  /**
   * Name every train on the map and give it a larger click target. On a long
   * corridor shown at about 0.4 scale a train is a dot of a few pixels, and the
   * interview's first pilot run lost time hitting it.
   */
  mapTrainLabels?: boolean;
  /** «Szenario starten» on the mode intro also starts the run, as its label says. */
  autoStart?: boolean;
  /** Replaces the default intro of a mode while this tour runs. */
  modeIntros?: Partial<Record<InteractionMode, ModeIntro>>;
  /** Panel type → module name: these panels carry a "Co-Learning" badge. */
  moduleBadges?: Record<string, string>;
  /** Start the map on this column range (first, last), for long corridors. */
  mapFocusCols?: [number, number];
  /** Section the Zug-Weg-Diagramm opens on, as two station codes of the
   *  scenario's geography (e.g. Olten: towards Bern → towards Basel). Set for
   *  every session the tour starts; the person can change it. */
  zugWegRoute?: { from: string; to: string };
  /** Page before the first mode intro. Optional: a short tour can go straight
   *  to its mode intro. */
  opening?: {
    eyebrow: string;
    title: string;
    lead: string;
    byline: string;
    sections: BriefingSection[];
    proceedLabel: string;
  };
  /** Overview after the last mode; without it the generic end page shows. */
  closing?: {
    eyebrow: string;
    title: string;
    lead: string;
    kolbIntro: string;
    kolb: KolbPhase[];
    loops: { name: string; steps: LoopStep[] }[];
    loopsNote: string;
    modules: BriefingModule[];
    statusLabels: Record<ModuleStatus, string>;
    estimationReminder: string;
    disclaimer: string;
    sources: string;
  };
}

const PROTOTYPE_DISCLAIMER =
  'Das ist ein Prototyp: Aussehen und Texte der Panels sind nicht endgültig. Es geht darum, was die Funktionen leisten, nicht wie sie aussehen.';

const CO_LEARNING_COST_BENEFIT_DE: TourBriefing = {
    id: 'co-learning-cost-benefit',
    // Ziegelbrücke (col 71) to Walenstadt (col 124): both starts, the shared
    // track after Weesen and the single-track section in between.
    mapFocusCols: [69, 126],
    debrief: true,
    freshOperatorProfile: true,
    // For the demo: makes step 6 hard to miss. The interview layout has no
    // reflection panel, so switching this off needs that panel back in the preset.
    reasonDialog: true,
    assessmentOnly: true,
    language: 'de',
    mapTrainLabels: true,
    autoStart: true,
    // Steps 1-9 of the thesis' interaction flow (Table 2): operational loop 1-5,
    // learning loop 6-9, with shift summary and event simulation after the episode.
    guide: [
      {
        id: 'detect',
        loop: 'operational',
        title: 'Konflikt erkennen',
        hint: 'Die Simulation läuft. Beobachte die Strecke: Nach kurzer Zeit bleibt ein Zug im Einspurabschnitt stehen, und das TMS meldet die Störung links.',
      },
      {
        id: 'assess',
        loop: 'operational',
        module: true,
        panelType: 'impact',
        title: 'Risiko & Auswirkung',
        hint: 'Neu: «Lage: Risiko & Auswirkung» zeigt, welcher Zug betroffen ist, wie lange er stehen würde und welche Massnahmen möglich sind. Entschieden wird hier nicht; der Zug wartet.',
      },
      {
        id: 'alternatives',
        loop: 'operational',
        module: true,
        panelType: 'proposal-compare',
        title: 'Alternativen',
        hint: 'Neu: Die KI bietet Optionen an, ohne eine zu empfehlen. Unter «Plan / KI / Mensch» siehst du vorab, was der Plan, der KI-Vorschlag und deine eigene Wahl für den Zug bedeuten.',
      },
      {
        id: 'decide',
        loop: 'operational',
        panelType: 'proposal-compare',
        title: 'Entscheiden',
        hint: 'Wähle unter «Plan / KI / Mensch» eine Option für den betroffenen Zug und übernimm sie.',
      },
      {
        id: 'execute',
        loop: 'operational',
        title: 'Umsetzen',
        hint: 'Das TMS setzt deine Wahl um. Lass die Simulation weiterlaufen.',
      },
      {
        id: 'reflect',
        loop: 'learning',
        module: true,
        title: 'Reflexion',
        hint: 'Neu: Nach deiner Entscheidung hält die Simulation an und fragt nach deinem Grund. Wähle einen Grund, danach «Ja, als Regel» oder «Nur diesmal».',
      },
      {
        id: 'shift-summary',
        loop: 'learning',
        module: true,
        afterEpisode: true,
        title: 'Schichtbilanz',
        hint: 'Nach der Episode: alle Massnahmen und ihre Wirkung über die ganze Schicht.',
      },
      {
        id: 'event-simulation',
        loop: 'learning',
        module: true,
        afterEpisode: true,
        title: 'Event-Simulation',
        hint: 'Nach der Episode, in der Sandbox: den erlebten Vorfall mit einer anderen Entscheidung nochmals durchspielen.',
      },
      {
        id: 'ai-learns',
        loop: 'learning',
        module: true,
        title: 'KI lernt',
        hint: 'Neu: Die KI übernimmt bestätigte Gründe in ihr Modell. Nach der Schicht siehst du das als Lern-Karte.',
      },
    ],
    // Panels that belong to the Co-Learning extension: they carry the violet
    // edge. The name is the tooltip and the wording used in the closing
    // overview — the panels themselves are no longer labelled.
    moduleBadges: {
      impact: 'Risiko- und Auswirkungsanalyse',
      'proposal-compare': 'Auswirkungsanalyse: Plan, KI-Vorschlag und deine Wahl',
      'decision-log': 'Grundlage für Reflexion und Lernen',
    },
    modeIntros: {
      'co-learning': {
        mode: 'co-learning',
        wp: 'Co-Learning · Walensee',
        title: 'Eine Störung am Einspurabschnitt',
        tagline: 'Die KI zeigt Auswirkungen und Optionen. Du entscheidest und lernst daraus.',
        whatHappens:
          'Strecke Pfäffikon SZ–Chur am Walensee, von Ziegelbrücke bis Walenstadt, mit einem einspurigen Abschnitt. Drei Züge fahren nach Fahrplan. Nach kurzer Zeit bleibt ein Zug mitten im Einspurabschnitt stehen, und der Zug dahinter läuft auf ihn auf. Wie es weitergeht, entscheidest du.',
        focusView:
          'In der Mitte Streckenspiegel und Zug-Weg-Diagramm als Tabs, darunter der Fahrplan. Den Streckenspiegel ziehst du mit der Maus seitlich, mit dem Mausrad zoomst du. Rechts liegen die Co-Learning-Module.',
        yourRole:
          'Du disponierst. Die KI rankt nichts und empfiehlt nichts: Du wählst selbst, vergleichst danach mit einer Alternative und denkst über deine Entscheidung nach.',
        whatYouCanControl: [
          'Die Simulation starten, pausieren oder schrittweise laufen lassen',
          'Für einen betroffenen Zug eine Option wählen',
          'Unter «Plan / KI / Mensch» vorab vergleichen: Plan, KI-Vorschlag und deine eigene Wahl',
          'Nach einer Entscheidung den Grund angeben, als Regel oder nur für diesmal',
        ],
        watchFor: [
          'Panels mit violettem Rand sind die neue Erweiterung. Alles andere steht für das TMS als Ganzes.',
          'Optionen erscheinen ohne Ranking und ohne «empfohlen»',
          'Blau steht für deine Entscheidung, gelb für die Variante der KI',
          'Oben führt ein Leitfaden durch die neun Schritte. Das jeweils nächste Modul wird hervorgehoben.',
        ],
        goal:
          'Es geht nicht um die perfekte Disposition, sondern um ein Gefühl dafür, was die Module leisten, als Grundlage für deine Schätzung.',
        note: PROTOTYPE_DISCLAIMER,
        labels: {
          stepPrefix: 'Modus',
          stepOf: 'von',
          whatHappens: 'Was passiert',
          focusView: 'Wohin du schaust',
          yourRole: 'Deine Rolle',
          control: 'Was du tun kannst',
          watchFor: 'Worauf du achtest',
          goal: 'Ziel',
          start: 'Szenario starten',
          exit: 'Tour beenden',
        },
      },
    },
    opening: {
      eyebrow: 'Experteninterview · Co-Learning',
      title: 'Co-Learning in der Disposition erleben',
      lead:
        'Eine Viertelstunde Co-Learning zum Ausprobieren, als gemeinsame Grundlage für das Interview danach.',
      byline: 'Daniel Boos · CAS Financial Decision Making, iimt Universität Freiburg · im Rahmen von AI4REALNET',
      sections: [
        {
          heading: 'Das Projekt',
          body:
            'AI4REALNET erforscht die Zusammenarbeit von Mensch und KI in sicherheitskritischen Netzen, mit MARL-Algorithmen (Multi-Agent Reinforcement Learning: mehrere lernende KI-Agenten). Co-Learning ist ein Aspekt davon.',
        },
        {
          heading: 'Worum es geht',
          body:
            'Co-Learning heisst: Disponentin und KI lernen voneinander. Die KI zeigt Auswirkungen und Alternativen, du entscheidest und begründest, die KI passt sich an. Es geht um eine Erweiterung des TMS, nicht um ein KI-gesteuertes System.',
        },
        {
          heading: 'Was wir von dir brauchen',
          body:
            'Deine Schätzungen fliessen in eine Kosten-Nutzen-Rechnung, die viele mögliche Verläufe über zehn Jahre durchspielt (Monte-Carlo-Simulation).',
          items: [
            'Pro Kosten- und Nutzenposition drei Werte: Maximum, Minimum, wahrscheinlichster Wert, in Personenmonaten oder CHF',
            'Bezug ist ein fertiges, im Betrieb eingeführtes System, nicht dieser Prototyp',
            'Eine breite Spanne ist eine gültige Antwort',
          ],
        },
        {
          heading: 'Wer entscheidet was',
          items: [
            'TMS: plant den Fahrplan und passt ihn mit seinem Optimierungsalgorithmus an',
            'KI: schlägt für die konkrete Lage Abweichungen vor, gedacht als MARL-Agenten; im Prototyp rechnet noch ein klassischer Planer',
            'Du: entscheidest als Fachperson, und daraus lernt die KI',
          ],
        },
        {
          heading: 'Zum Prototyp',
          body:
            'Flatland ist eine bewusst vereinfachte Bahnsimulation: keine Signale, keine Fahrdynamik. Die neuen Co-Learning-Module haben einen violetten Rand. ' +
            PROTOTYPE_DISCLAIMER,
        },
      ],
      proceedLabel: 'Weiter zur Tour',
    },
    closing: {
      eyebrow: 'Übersicht · Grundlage für die Schätzung',
      title: 'Die Co-Learning-Module im Überblick',
      lead:
        'Sechs Module stützen den gemeinsamen Lernprozess von Disponentin und KI. Sie sind entlang des Lernzyklus nach Kolb angeordnet.',
      kolbIntro:
        'Lernen aus Erfahrung verläuft in vier Phasen. Drei davon kann ein Co-Learning-System unterstützen. Die abstrakte Begriffsbildung bleibt heute beim Menschen.',
      kolb: [
        { name: 'Konkrete Erfahrung', supported: true, note: 'Eine Situation erleben: Auswirkungen und Handlungsoptionen' },
        { name: 'Reflexion', supported: true, note: 'Zurückblicken: Was ist passiert, warum habe ich so entschieden?' },
        { name: 'Abstrakte Begriffsbildung', supported: false, note: 'Eigene Regeln ableiten, technisch nicht unterstützt' },
        { name: 'Aktives Experimentieren', supported: true, note: 'Ausprobieren: Alternativen und Vorfälle in der Sandbox' },
      ],
      loops: [
        {
          name: 'Operativer Loop',
          steps: [
            { actor: 'TMS', action: 'erkennt einen Konflikt oder eine Störung' },
            { actor: 'KI', action: 'bewertet Risiko und Auswirkungen' },
            { actor: 'KI', action: 'schlägt Alternativen vor' },
            { actor: 'Disponent/in', action: 'prüft und entscheidet' },
            { actor: 'TMS', action: 'setzt um, aktualisiert Netz und KPIs' },
          ],
        },
        {
          name: 'Lern-Loop',
          steps: [
            { actor: 'KI', action: 'regt Reflexion an, bündelt ähnliche Situationen' },
            { actor: 'KI / TMS', action: 'fasst Massnahmen und KPI-Wirkung der Schicht zusammen' },
            { actor: 'Disponent/in', action: 'übt bekannte und neue Hochrisiko-Fälle in der Sandbox' },
            { actor: 'KI', action: 'aktualisiert ihr Modell aus dem Feedback' },
          ],
        },
      ],
      loopsNote:
        'In der Praxis wird auch im operativen Loop gelernt. Die Trennung vereinfacht die Kostenschätzung.',
      modules: [
        {
          name: 'Risiko- & Auswirkungsanalyse',
          area: 'Impact Analysis',
          kolbPhase: 'Konkrete Erfahrung',
          does: 'Zeitpuffer berechnen, nötige Massnahmen und betroffene Sektoren zeigen, Wirkung auf betroffene Züge abschätzen',
          inTour: 'Panel «Lage: Risiko & Auswirkung» rechts, sobald die Störung wirkt',
          status: 'partial',
          statusNote: 'Betroffene Züge, Zeitpuffer, Art der Massnahmen und betroffener Abschnitt live; der Abschnitt ist nur zwischen zwei Orten benannt, nicht nach Stellwerksektoren',
        },
        {
          name: 'Alternativen',
          area: 'Alternative Actions',
          kolbPhase: 'Konkrete Erfahrung',
          does: 'Von der KI berechnete Handlungsalternativen',
          inTour: 'Panel «Plan / KI / Mensch»: Plan, KI-Neuplanung und deine Wahl im Vergleich, auch direkt am Zug auf der Karte',
          status: 'live',
          statusNote: 'Erlebbar; die KI rechnet mit einem klassischen Planer statt mit gelernten Agenten',
        },
        {
          name: 'Reflexion',
          area: 'Reflection',
          kolbPhase: 'Reflexion',
          does: 'Reflexionsfragen stellen, ähnliche Situationen bündeln, automatisch zusammenfassen, anonymisiert im Team teilen',
          inTour: 'Dialog «Warum diese Entscheidung?» direkt nach dem Entscheid (Schritt 6)',
          status: 'partial',
          statusNote: 'Fragen und Rückspiegelung live, Teilen im Team nicht gebaut',
        },
        {
          name: 'Schichtbilanz',
          area: 'Sandbox',
          kolbPhase: 'Aktives Experimentieren',
          does: 'Alle Massnahmen, betroffenen Züge und KPIs einer Schicht zusammenfassen',
          inTour: 'Nach der Schicht (Schritt 7)',
          status: 'live',
          statusNote: 'Erlebbar; fasst hier eine Episode zusammen, nicht eine ganze Schicht',
        },
        {
          name: 'Event-Simulation',
          area: 'Sandbox',
          kolbPhase: 'Aktives Experimentieren',
          does: 'Erlebte Vorfälle mit anderen Massnahmen durchspielen, nie erlebte Hochrisiko-Fälle üben',
          inTour: 'Nach der Schicht in der Sandbox (Schritt 8)',
          status: 'partial',
          statusNote: 'Varianten mit dem Simulator vorberechnet, noch nicht selbst durchspielbar',
        },
        {
          name: 'System-Co-Learning',
          area: 'Co-Learning AI',
          kolbPhase: 'KI-seitig',
          does: 'Empfehlungsmodell aus dem Feedback anpassen, Input für TMS-Algorithmen liefern',
          inTour: 'Lern-Karten nach der Schicht (Schritt 9)',
          status: 'partial',
          statusNote: 'Präferenzmodell live, Rückfluss ins TMS nur Konzept',
        },
      ],
      statusLabels: {
        live: 'erlebbar',
        partial: 'teilweise',
        concept: 'Konzept',
      },
      estimationReminder:
        'Bitte schätze für ein fertiges, im Betrieb eingeführtes System, nicht für diesen Prototyp: Maximum, Minimum, wahrscheinlichster Wert.',
      disclaimer: PROTOTYPE_DISCLAIMER,
      sources: 'Grundlagen: Hamouche et al. (2026), Mussi et al. (2025), Bessa et al. (2026), AI4REALNET.',
    },
};

const PROTOTYPE_DISCLAIMER_EN =
  'This is a prototype: the look and wording of the panels are not final. What matters is what the functions do, not how they look.';

/**
 * English twin of the interview briefing, for showing the tour to an English
 * audience. Same flags, same scenario, same steps; only the tour-owned text is
 * translated (the German one stays the interview instrument).
 */
const CO_LEARNING_COST_BENEFIT_EN: TourBriefing = {
  ...CO_LEARNING_COST_BENEFIT_DE,
  id: 'co-learning-cost-benefit-en',
  language: 'en',
  guide: [
    {
      id: 'detect',
      loop: 'operational',
      title: 'Detect conflict',
      hint: 'The simulation is running. Watch the line: after a short while a train stops in the single-track section, and the TMS reports the disruption on the left.',
    },
    {
      id: 'assess',
      loop: 'operational',
      module: true,
      panelType: 'impact',
      title: 'Risk & impact',
      hint: 'New: «Situation: risk & impact» shows which train is affected, how long it would wait and which measures are possible. Nothing is decided here; the train waits.',
    },
    {
      id: 'alternatives',
      loop: 'operational',
      module: true,
      panelType: 'proposal-compare',
      title: 'Alternatives',
      hint: 'New: the AI offers options without recommending one. Under «Plan / AI / Human» you see in advance what the plan, the AI proposal and your own choice mean for the train.',
    },
    {
      id: 'decide',
      loop: 'operational',
      panelType: 'proposal-compare',
      title: 'Decide',
      hint: 'Pick an option for the affected train under «Plan / AI / Human» and apply it.',
    },
    {
      id: 'execute',
      loop: 'operational',
      title: 'Execute',
      hint: 'The TMS carries out your choice. Let the simulation run on.',
    },
    {
      id: 'reflect',
      loop: 'learning',
      module: true,
      title: 'Reflection',
      hint: 'New: after your decision the simulation pauses and asks for your reason. Pick a reason, then «Yes, as a rule» or «Just this once».',
    },
    {
      id: 'shift-summary',
      loop: 'learning',
      module: true,
      afterEpisode: true,
      title: 'Shift summary',
      hint: 'After the episode: all measures and their effect over the whole shift.',
    },
    {
      id: 'event-simulation',
      loop: 'learning',
      module: true,
      afterEpisode: true,
      title: 'Event simulation',
      hint: 'After the episode, in the sandbox: replay the incident you just had with a different decision.',
    },
    {
      id: 'ai-learns',
      loop: 'learning',
      module: true,
      title: 'AI learns',
      hint: 'New: the AI takes confirmed reasons into its model. After the shift you see this as a learning card.',
    },
  ],
  moduleBadges: {
    impact: 'Risk and impact analysis',
    'proposal-compare': 'Impact analysis: plan, AI proposal and your choice',
    'decision-log': 'Basis for reflection and learning',
  },
  modeIntros: {
    'co-learning': {
      mode: 'co-learning',
      wp: 'Co-Learning · Walensee',
      title: 'A disruption in the single-track section',
      tagline: 'The AI shows impacts and options. You decide and learn from it.',
      whatHappens:
        'The Pfäffikon SZ–Chur line along the Walensee, from Ziegelbrücke to Walenstadt, with a single-track section. Three trains run to the timetable. After a short while one train stops in the middle of the single-track section, and the train behind it runs up on it. What happens next is up to you.',
      focusView:
        'In the centre, the track diagram and the train path diagram as tabs, the timetable below. Drag the track diagram sideways with the mouse, zoom with the wheel. The Co-Learning modules are on the right.',
      yourRole:
        'You dispatch. The AI ranks nothing and recommends nothing: you choose yourself, then compare with an alternative and think about your decision.',
      whatYouCanControl: [
        'Start, pause or step the simulation',
        'Choose an option for an affected train',
        'Compare in advance under «Plan / AI / Human»: plan, AI proposal and your own choice',
        'After a decision, give your reason, as a rule or just for this time',
      ],
      watchFor: [
        'Panels with a violet edge are the new extension. Everything else stands for the TMS as a whole.',
        'Options appear without ranking and without «recommended»',
        'Blue stands for your decision, yellow for the AI’s variant',
        'A guide at the top leads through the nine steps. The next module is highlighted.',
      ],
      goal:
        'This is not about perfect dispatching, but about getting a feel for what the modules do, as a basis for your estimate.',
      note: PROTOTYPE_DISCLAIMER_EN,
      labels: {
        stepPrefix: 'Mode',
        stepOf: 'of',
        whatHappens: 'What happens',
        focusView: 'Where to look',
        yourRole: 'Your role',
        control: 'What you can do',
        watchFor: 'What to watch for',
        goal: 'Goal',
        start: 'Start scenario',
        exit: 'End tour',
      },
    },
  },
  opening: {
    eyebrow: 'Expert interview · Co-Learning',
    title: 'Experience Co-Learning in dispatching',
    lead: 'A quarter of an hour of Co-Learning to try out, as a shared basis for the interview that follows.',
    byline: 'Daniel Boos · CAS Financial Decision Making, iimt University of Fribourg · as part of AI4REALNET',
    sections: [
      {
        heading: 'The project',
        body:
          'AI4REALNET researches how humans and AI work together in safety-critical networks, with MARL algorithms (multi-agent reinforcement learning: several learning AI agents). Co-Learning is one aspect of it.',
      },
      {
        heading: 'What it is about',
        body:
          'Co-Learning means the dispatcher and the AI learn from each other. The AI shows impacts and alternatives, you decide and give your reasons, the AI adapts. It is an extension of the TMS, not an AI-controlled system.',
      },
      {
        heading: 'What we need from you',
        body:
          'Your estimates feed a cost-benefit calculation that plays through many possible courses over ten years (Monte Carlo simulation).',
        items: [
          'Three values per cost and benefit item: maximum, minimum, most likely value, in person-months or CHF',
          'The reference is a finished system in operation, not this prototype',
          'A wide range is a valid answer',
        ],
      },
      {
        heading: 'Who decides what',
        items: [
          'TMS: plans the timetable and adjusts it with its optimisation algorithm',
          'AI: proposes deviations for the concrete situation, intended as MARL agents; in the prototype a classic planner still does the computing',
          'You: decide as the expert, and the AI learns from that',
        ],
      },
      {
        heading: 'About the prototype',
        body:
          'Flatland is a deliberately simplified railway simulation: no signals, no train dynamics. The new Co-Learning modules have a violet edge. ' +
          PROTOTYPE_DISCLAIMER_EN,
      },
    ],
    proceedLabel: 'Continue to the tour',
  },
  closing: {
    eyebrow: 'Overview · basis for the estimate',
    title: 'The Co-Learning modules at a glance',
    lead:
      'Six modules support the shared learning process of dispatcher and AI. They are arranged along Kolb’s learning cycle.',
    kolbIntro:
      'Learning from experience runs through four phases. A Co-Learning system can support three of them. Abstract conceptualisation stays with the human today.',
    kolb: [
      { name: 'Concrete experience', supported: true, note: 'Living through a situation: impacts and options for action' },
      { name: 'Reflective observation', supported: true, note: 'Looking back: what happened, why did I decide that way?' },
      { name: 'Abstract conceptualisation', supported: false, note: 'Deriving your own rules, not supported technically' },
      { name: 'Active experimentation', supported: true, note: 'Trying things out: alternatives and incidents in the sandbox' },
    ],
    loops: [
      {
        name: 'Operational loop',
        steps: [
          { actor: 'TMS', action: 'detects a conflict or disruption' },
          { actor: 'AI', action: 'assesses risk and impact' },
          { actor: 'AI', action: 'proposes alternatives' },
          { actor: 'Dispatcher', action: 'reviews and decides' },
          { actor: 'TMS', action: 'executes, updates network and KPIs' },
        ],
      },
      {
        name: 'Learning loop',
        steps: [
          { actor: 'AI', action: 'prompts reflection, groups similar situations' },
          { actor: 'AI / TMS', action: 'summarises the shift’s measures and KPI effect' },
          { actor: 'Dispatcher', action: 'practises known and new high-risk cases in the sandbox' },
          { actor: 'AI', action: 'updates its model from the feedback' },
        ],
      },
    ],
    loopsNote:
      'In practice there is learning in the operational loop too. The split simplifies the cost estimate.',
    modules: [
      {
        name: 'Risk & impact analysis',
        area: 'Impact Analysis',
        kolbPhase: 'Concrete experience',
        does: 'Compute time buffers, show required measures and affected sectors, estimate the effect on affected trains',
        inTour: 'Panel «Situation: risk & impact» on the right, as soon as the disruption takes effect',
        status: 'partial',
        statusNote: 'Affected trains, time buffer, kind of measure and affected section live; the section is only named between two places, not by interlocking sector',
      },
      {
        name: 'Alternatives',
        area: 'Alternative Actions',
        kolbPhase: 'Concrete experience',
        does: 'Options for action computed by the AI',
        inTour: 'Panel «Plan / AI / Human»: plan, AI replan and your choice side by side, also directly at the train on the map',
        status: 'live',
        statusNote: 'Hands-on; the AI computes with a classic planner instead of learned agents',
      },
      {
        name: 'Reflection',
        area: 'Reflection',
        kolbPhase: 'Reflective observation',
        does: 'Ask reflection questions, group similar situations, summarise automatically, share anonymised in the team',
        inTour: 'Dialog «Why this decision?» right after the decision (step 6)',
        status: 'partial',
        statusNote: 'Questions and feedback live, team sharing not built',
      },
      {
        name: 'Shift summary',
        area: 'Sandbox',
        kolbPhase: 'Active experimentation',
        does: 'Summarise all measures, affected trains and KPIs of a shift',
        inTour: 'After the shift (step 7)',
        status: 'live',
        statusNote: 'Hands-on; summarises one episode here, not a whole shift',
      },
      {
        name: 'Event simulation',
        area: 'Sandbox',
        kolbPhase: 'Active experimentation',
        does: 'Replay incidents you had with other measures, practise high-risk cases never experienced',
        inTour: 'After the shift in the sandbox (step 8)',
        status: 'partial',
        statusNote: 'Variants precomputed with the simulator, not yet playable yourself',
      },
      {
        name: 'System co-learning',
        area: 'Co-Learning AI',
        kolbPhase: 'AI side',
        does: 'Adapt the recommendation model from feedback, provide input for TMS algorithms',
        inTour: 'Learning cards after the shift (step 9)',
        status: 'partial',
        statusNote: 'Preference model live, feedback into the TMS concept only',
      },
    ],
    statusLabels: {
      live: 'hands-on',
      partial: 'partial',
      concept: 'concept',
    },
    estimationReminder:
      'Please estimate for a finished system in operation, not for this prototype: maximum, minimum, most likely value.',
    disclaimer: PROTOTYPE_DISCLAIMER_EN,
    sources: 'Sources: Hamouche et al. (2026), Mussi et al. (2025), Bessa et al. (2026), AI4REALNET.',
  },
};

/**
 * Olten: explore the Zug-Weg-Diagramm — a short Recommendation-mode tour on a
 * real Swiss node (flatland-scenarios), in its own layout
 * (`preset-olten-zug-weg`), on `olten-dense`: the hour's timetable compressed
 * threefold, so trains get in each other's way without a scripted breakdown
 * (the original ran ~3 trains at a time, too few for strategies to differ).
 * No opening or closing page: the mode intro frames it.
 */
const OLTEN_ZUG_WEG_BASE = {
  zugWegRoute: { from: 'P-BERN', to: 'P-BASEL' },
  autoStart: true,
} as const;

const OLTEN_ZUG_WEG_EN: TourBriefing = {
  ...OLTEN_ZUG_WEG_BASE,
  id: 'olten-zug-weg-en',
  language: 'en',
  modeIntros: {
    recommendation: {
      mode: 'recommendation',
      wp: 'Recommendation · Olten',
      title: 'Explore the Zug-Weg-Diagramm',
      tagline: 'A real node, run busy. The AI simulates the strategies; you decide and steer.',
      whatHappens:
        'Olten: ten platform tracks and six lines leaving towards Basel, Sissach, Aarau, Solothurn, Bern and Luzern. The hour’s 52 trains are compressed into about twenty minutes, so some nine run at once; trains also break down at random now and then. After about two minutes the node fills up and trains start to get in each other’s way.',
      focusView:
        'In the centre: the track diagram on the left, the Zug-Weg-Diagramm on the right with the timetable below. The diagram opens on the section towards Bern → towards Basel; choose any other section — or click a station on the map — with From / To above it. Events are on the left, Combined Actions and the train detail on the right.',
      yourRole:
        'You dispatch. When trains block each other, Combined Actions simulates three strategies for the whole network — keep course, switch strategy, re-plan all trains (PP, AI4REALNET) — and marks the best with its confidence; you choose, reorder the re-plan or keep course — and you can steer single trains yourself.',
      whatYouCanControl: [
        'Start, pause or step the simulation',
        'Choose the section the Zug-Weg-Diagramm shows (From / To, swap)',
        'Pick a train in the diagram, on the map or in the timetable, then steer it in the train detail',
        'Choose, reorder or reject the AI’s package in Combined Actions',
      ],
      watchFor: [
        'Solid line = what happened, dashed = the forecast; red ribbons = a forecast conflict on the section',
        'A train picked in one view is highlighted in all three',
        'Trains enter and leave the diagram where they join or leave the chosen section',
        'Olten has no timetable plan, so there is no target line and no delay marks here — the Walensee tours show those',
      ],
      goal: 'Get a feel for reading traffic along a section of a network, seeing a conflict coming in the forecast, and resolving it with the AI’s ranked options at hand.',
      note: 'This is a prototype: the look and wording of the panels are not final.',
      labels: {
        stepPrefix: 'Mode',
        stepOf: 'of',
        whatHappens: 'What happens',
        focusView: 'Where to look',
        yourRole: 'Your role',
        control: 'What you can do',
        watchFor: 'What to watch for',
        goal: 'Goal',
        start: 'Start scenario',
        exit: 'End tour',
      },
    },
  },
};

const OLTEN_ZUG_WEG_DE: TourBriefing = {
  ...OLTEN_ZUG_WEG_BASE,
  id: 'olten-zug-weg-de',
  language: 'de',
  modeIntros: {
    recommendation: {
      mode: 'recommendation',
      wp: 'Recommendation · Olten',
      title: 'Das Zug-Weg-Diagramm erkunden',
      tagline: 'Ein echter Knoten, voll ausgelastet. Die KI simuliert die Strategien; du entscheidest und steuerst.',
      whatHappens:
        'Olten: zehn Bahnsteiggleise und sechs Linien Richtung Basel, Sissach, Aarau, Solothurn, Bern und Luzern. Die 52 Züge einer Stunde sind auf etwa zwanzig Minuten gestaucht, rund neun fahren gleichzeitig; ab und zu fällt zufällig einer aus. Nach etwa zwei Minuten füllt sich der Knoten, und die Züge kommen sich in die Quere.',
      focusView:
        'In der Mitte links der Streckenspiegel, rechts das Zug-Weg-Diagramm mit dem Fahrplan darunter. Das Diagramm zeigt zuerst den Abschnitt Richtung Bern → Richtung Basel; mit Von / Nach darüber — oder per Klick auf eine Station im Streckenspiegel — wählst du jeden anderen. Links die Ereignisse, rechts Combined Actions und das Zug-Detail.',
      yourRole:
        'Du disponierst. Blockieren sich Züge, simuliert Combined Actions drei Strategien fürs ganze Netz — weiter wie bisher, Strategie wechseln, alle Züge neu planen (PP, AI4REALNET) — und markiert die beste mit ihrer Sicherheit; du wählst, ordnest die Neuplanung um oder bleibst dabei — und kannst einzelne Züge selbst steuern.',
      whatYouCanControl: [
        'Die Simulation starten, pausieren oder schrittweise laufen lassen',
        'Den Abschnitt des Zug-Weg-Diagramms wählen (Von / Nach, Richtung tauschen)',
        'Einen Zug im Diagramm, auf der Karte oder im Fahrplan anklicken und im Zug-Detail steuern',
        'Das Paket der KI in Combined Actions wählen, umordnen oder ablehnen',
      ],
      watchFor: [
        'Durchgezogen = was passiert ist, gestrichelt = die Prognose; rote Bänder = ein prognostizierter Konflikt auf dem Abschnitt',
        'Ein gewählter Zug ist in allen drei Ansichten hervorgehoben',
        'Züge erscheinen und verschwinden dort, wo sie in den gewählten Abschnitt ein- oder aus ihm herausfahren',
        'Olten hat keinen Soll-Fahrplan, darum fehlen hier Soll-Linie und Verspätungsmarken — die zeigen die Walensee-Touren',
      ],
      goal: 'Ein Gefühl dafür bekommen, wie man Verkehr entlang eines Abschnitts in einem Netz liest, einen Konflikt in der Prognose kommen sieht und ihn mit den gerankten Optionen der KI löst.',
      note: 'Das ist ein Prototyp: Aussehen und Texte der Panels sind nicht endgültig.',
      labels: {
        stepPrefix: 'Modus',
        stepOf: 'von',
        whatHappens: 'Was passiert',
        focusView: 'Wohin du schaust',
        yourRole: 'Deine Rolle',
        control: 'Was du tun kannst',
        watchFor: 'Worauf du achtest',
        goal: 'Ziel',
        start: 'Szenario starten',
        exit: 'Tour beenden',
      },
    },
  },
};

/**
 * Walensee: strategies on the Zug-Weg-Diagramm — the corridor twin of the Olten
 * tour, where the simulated strategies actually differ. Its own breakdown
 * (`strategy-e1-breakdown-weesen`): the train due first through the
 * single-track section stops in Weesen; keeping the plan makes the others wait
 * (~50 min), a PP re-plan lets them go first (~24 min), Shortest Path
 * deadlocks the section.
 */
const WALENSEE_ZUG_WEG_BASE = {
  zugWegRoute: { from: 'ZB', to: 'WAL' },
  mapFocusCols: [69, 126] as [number, number],
  mapTrainLabels: true,
  autoStart: true,
} as const;

const WALENSEE_ZUG_WEG_EN: TourBriefing = {
  ...WALENSEE_ZUG_WEG_BASE,
  id: 'walensee-zug-weg-en',
  language: 'en',
  modeIntros: {
    recommendation: {
      mode: 'recommendation',
      wp: 'Recommendation · Walensee',
      title: 'Strategies for a single-track conflict',
      tagline: 'The first train for the single-track section breaks down. The AI simulates the strategies; you choose.',
      whatHappens:
        'The Pfäffikon SZ–Chur line along the Walensee, Ziegelbrücke to Walenstadt, with a single-track section between Mühlehorn and Tiefenwinkel. Three trains run to the timetable; IC_703 is due through the section first. After about 20 seconds it breaks down in Weesen, just before the section — and the timetable still has the others wait for it. The run stops by itself once the conflict is forecast, so you can read the strategies.',
      focusView:
        'In the centre: the track diagram on top, the Zug-Weg-Diagramm below it (opening on Ziegelbrücke → Walenstadt) and the timetable. On the right, Combined Actions compares three strategies, each simulated to the same horizon; below it the train detail.',
      yourRole:
        'You dispatch. The AI marks the strategy with the best simulated outcome and says how sure it is; you choose, reorder the re-plan, or keep course — and you can steer single trains in the diagram yourself.',
      whatYouCanControl: [
        'Start, pause or step the simulation',
        'Compare the strategies: keep course, switch strategy, re-plan all trains (PP, AI4REALNET)',
        'Reorder the trains of the re-plan: the planner re-solves your order',
        'Apply a strategy — it drives all trains until you change it',
        'Pick a train and steer it at its next switch, in the diagram or in the train detail',
      ],
      watchFor: [
        'Keep course means waiting for IC_703; the re-plan lets ICE_42 overtake in Weesen and RE_18 through first',
        'Decide early: the longer you wait, the less the re-plan can still save',
        'A strategy can cost time: “↑ n min” — or deadlock the section entirely',
        'The confidence says how clearly the best strategy beats the runner-up',
        'Solid = what happened, dashed = the forecast, thin = the timetable',
      ],
      goal: 'See what re-planning is worth against the timetable, why deciding early matters — and why a strategy switch that sounds harmless can block a single-track section.',
      note: 'This is a prototype: the look and wording of the panels are not final.',
      labels: {
        stepPrefix: 'Mode', stepOf: 'of', whatHappens: 'What happens', focusView: 'Where to look', yourRole: 'Your role',
        control: 'What you can do', watchFor: 'What to watch for', goal: 'Goal', start: 'Start scenario', exit: 'End tour',
      },
    },
  },
};

const WALENSEE_ZUG_WEG_DE: TourBriefing = {
  ...WALENSEE_ZUG_WEG_BASE,
  id: 'walensee-zug-weg-de',
  language: 'de',
  modeIntros: {
    recommendation: {
      mode: 'recommendation',
      wp: 'Recommendation · Walensee',
      title: 'Strategien für einen Einspur-Konflikt',
      tagline: 'Der erste Zug für den Einspurabschnitt fällt aus. Die KI simuliert die Strategien; du wählst.',
      whatHappens:
        'Strecke Pfäffikon SZ–Chur am Walensee, Ziegelbrücke bis Walenstadt, mit einem Einspurabschnitt zwischen Mühlehorn und Tiefenwinkel. Drei Züge fahren nach Fahrplan; IC_703 soll als Erster durch den Abschnitt. Nach etwa 20 Sekunden fällt er in Weesen aus, kurz vor dem Abschnitt — und der Fahrplan lässt die anderen weiter auf ihn warten. Sobald der Konflikt prognostiziert ist, hält die Simulation von selbst an, damit du die Strategien lesen kannst.',
      focusView:
        'In der Mitte oben der Streckenspiegel, darunter das Zug-Weg-Diagramm (startet mit Ziegelbrücke → Walenstadt) und der Fahrplan. Rechts vergleicht Combined Actions drei Strategien, jede bis zum selben Horizont simuliert; darunter das Zug-Detail.',
      yourRole:
        'Du disponierst. Die KI markiert die Strategie mit dem besten simulierten Ergebnis und sagt, wie sicher sie ist; du wählst, ordnest die Neuplanung um oder bleibst beim bisherigen Kurs — und kannst einzelne Züge im Diagramm selbst steuern.',
      whatYouCanControl: [
        'Die Simulation starten, pausieren oder schrittweise laufen lassen',
        'Die Strategien vergleichen: weiter wie bisher, Strategie wechseln, alle Züge neu planen (PP, AI4REALNET)',
        'Die Züge der Neuplanung umordnen: der Planer rechnet deine Reihenfolge neu',
        'Eine Strategie übernehmen — sie gilt für alle Züge, bis du sie änderst',
        'Einen Zug wählen und an seiner nächsten Weiche steuern, im Diagramm oder im Zug-Detail',
      ],
      watchFor: [
        'Weiter wie bisher heisst: auf IC_703 warten; die Neuplanung lässt ICE_42 in Weesen überholen und RE_18 zuerst durch',
        'Früh entscheiden: Je länger du wartest, desto weniger kann die Neuplanung noch sparen',
        'Eine Strategie kann Zeit kosten: «↑ n min» — oder den Abschnitt ganz blockieren',
        'Die Sicherheit sagt, wie klar die beste Strategie die zweitbeste schlägt',
        'Durchgezogen = was passiert ist, gestrichelt = die Prognose, dünn = der Fahrplan',
      ],
      goal: 'Sehen, was eine Neuplanung gegenüber dem Fahrplan wert ist, warum frühes Entscheiden zählt — und warum ein Strategiewechsel, der harmlos klingt, einen Einspurabschnitt blockieren kann.',
      note: 'Das ist ein Prototyp: Aussehen und Texte der Panels sind nicht endgültig.',
      labels: {
        stepPrefix: 'Modus', stepOf: 'von', whatHappens: 'Was passiert', focusView: 'Wohin du schaust', yourRole: 'Deine Rolle',
        control: 'Was du tun kannst', watchFor: 'Worauf du achtest', goal: 'Ziel', start: 'Szenario starten', exit: 'Tour beenden',
      },
    },
  },
};

export const TOUR_BRIEFINGS: TourBriefing[] = [
  CO_LEARNING_COST_BENEFIT_DE,
  CO_LEARNING_COST_BENEFIT_EN,
  OLTEN_ZUG_WEG_EN,
  OLTEN_ZUG_WEG_DE,
  WALENSEE_ZUG_WEG_EN,
  WALENSEE_ZUG_WEG_DE,
];

export function briefingById(id: string | undefined): TourBriefing | undefined {
  return id ? TOUR_BRIEFINGS.find((b) => b.id === id) : undefined;
}
