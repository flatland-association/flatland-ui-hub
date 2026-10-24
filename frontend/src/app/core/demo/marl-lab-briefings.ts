/**
 * MARL lab tours — the pages (docs/plans/marl-lab-tour.md, variant A).
 *
 * One loop, built twice: once in Co-Learning (the inspector stays neutral, the
 * person steps in on their own judgement) and once in Director (the AI drives
 * on its own and says what it will take; the person overrules it). Three runs
 * of the same scenario — the pretrained AI alone, with you, your AI — and the training
 * in the debrief between run 2 and 3.
 *
 * Written for people without an RL background (the SBB team, the consortium,
 * interviewees). Authored text per language like the other tours; German in
 * Swiss spelling with the informal du. The debrief section and the guide's
 * chrome are i18n keys (`lab.train.*`, `tourUi.*`).
 */
import type { InteractionMode } from '../events/event-types';
import type { ModeIntro, ModeIntroLabels } from './mode-intro-configs';
import type { BriefingSection, DebriefSectionId, TourBriefing, TourGuideStep } from './tour-briefings';

type MarlMode = Extract<InteractionMode, 'co-learning' | 'director'>;
type Lang = 'en' | 'de';

const LABELS: Record<Lang, ModeIntroLabels> = {
  en: {
    stepPrefix: 'Run', stepOf: 'of', whatHappens: 'What happens', focusView: 'Where to look', yourRole: 'Your role',
    control: 'What you can do', watchFor: 'What to watch for', goal: 'Goal', start: 'Start run', exit: 'End tour',
  },
  de: {
    stepPrefix: 'Lauf', stepOf: 'von', whatHappens: 'Was passiert', focusView: 'Wohin du schaust', yourRole: 'Deine Rolle',
    control: 'Was du tun kannst', watchFor: 'Worauf du achtest', goal: 'Ziel', start: 'Lauf starten', exit: 'Tour beenden',
  },
};

const NOTE: Record<Lang, string> = {
  en: 'This is a prototype: the look and wording of the panels are not final.',
  de: 'Das ist ein Prototyp: Aussehen und Texte der Panels sind nicht final.',
};

const SITUATION: Record<Lang, string> = {
  en: 'The Walensee line from Ziegelbrücke to Walenstadt, with the single-track section between Mühlehorn and Tiefenwinkel. Three trains; two of them have to pass each other where there is only one track. A learned AI decides for every train at every step; nothing is scripted.',
  de: 'Die Walensee-Strecke von Ziegelbrücke bis Walenstadt, mit dem Einspurabschnitt zwischen Mühlehorn und Tiefenwinkel. Drei Züge; zwei davon müssen sich kreuzen, wo es nur ein Gleis gibt. Eine gelernte KI entscheidet für jeden Zug in jedem Schritt; nichts ist geskriptet.',
};

/** Everything that differs between the Co-Learning and the Director loop. */
interface ModeText {
  eyebrow: string;
  title: string;
  lead: string;
  modeHeading: string;
  modeBody: string;
  run2Item: string;
  run2Tagline: string;
  run2WhatHappens: string;
  run2Focus: string;
  run2Role: string;
  run2Control: string;
  aiPickHint: string;
  interveneTitle: string;
  interveneHint: string;
  run1Role: string;
}

const MODE_TEXT: Record<MarlMode, Record<Lang, ModeText>> = {
  'co-learning': {
    en: {
      eyebrow: 'MARL lab · Co-Learning',
      title: 'Correct the AI — and retrain it',
      lead: 'A learned AI drives three trains through the single-track section on the Walensee. On its own it gets one of the three home; the other two block each other. In this tour you go once round the loop of learning between human and AI: watch the AI, step in, train it on what you did, and see whether it learned.',
      modeHeading: 'Co-Learning',
      modeBody: 'In Co-Learning you and the AI learn from each other. You get no recommendation to agree with: the options stay neutral, you form your own view, and the AI learns from your choices. The AI Track Record therefore counts where you and the AI chose the same — without judging who was right.',
      run2Item: 'Run 2 · With you: the same scenario. Pick the train at the Weesen switch and decide yourself. The options stay neutral: the AI does not tell you what it would do.',
      run2Tagline: 'The same scenario. Step in where you judge it right.',
      run2WhatHappens: 'The same three trains, the same AI. This time you may step in: pick a train and choose its route at its next switch. Each time you do, the system writes down what the AI saw, what it wanted and what you chose — that is what the AI learns from afterwards.',
      run2Focus: 'Trains on the left, map in the middle. Click a train: on the right, Train detail shows its next switch and the options there. In Co-Learning they are neutral — the AI does not mark its pick.',
      run2Role: 'You dispatch alongside the AI. Where you leave a train alone, the AI drives it.',
      run2Control: 'Pick a train and choose its option at the next switch',
      aiPickHint: 'Click the train heading for the Weesen switch. Train detail on the right shows its next switch and the options — neutral, without the AI’s pick.',
      interveneTitle: 'Step in',
      interveneHint: 'Choose the option that keeps the single track free. That is one intervention: what the AI saw, what it wanted and what you chose are recorded.',
      run1Role: 'Observer. Do not step in — this run shows what the AI does on its own.',
    },
    de: {
      eyebrow: 'MARL-Labor · Co-Learning',
      title: 'Die KI korrigieren — und neu trainieren',
      lead: 'Eine gelernte KI fährt drei Züge durch den Einspurabschnitt am Walensee. Allein bringt sie einen der drei ans Ziel; die anderen zwei blockieren sich gegenseitig. In dieser Tour gehst du einmal durch den Kreislauf, in dem Mensch und KI voneinander lernen: Du schaust der KI zu, greifst ein, trainierst sie auf das, was du getan hast, und schaust, ob sie es gelernt hat.',
      modeHeading: 'Co-Learning',
      modeBody: 'Im Co-Learning lernen du und die KI voneinander. Du bekommst keine Empfehlung, der du zustimmen kannst: Die Optionen bleiben neutral, du bildest dir deine eigene Meinung, und die KI lernt aus deiner Wahl. Der AI Track Record zählt darum, wo du und die KI dasselbe gewählt habt — ohne zu werten, wer recht hatte.',
      run2Item: 'Lauf 2 · Mit dir: dasselbe Szenario. Wähl den Zug an der Weiche Weesen und entscheide selbst. Die Optionen bleiben neutral: Die KI sagt dir nicht, was sie tun würde.',
      run2Tagline: 'Dasselbe Szenario. Greif ein, wo du es für richtig hältst.',
      run2WhatHappens: 'Dieselben drei Züge, dieselbe KI. Diesmal darfst du eingreifen: Wähl einen Zug und bestimme seinen Weg an der nächsten Weiche. Jedes Mal hält das System fest, was die KI gesehen hat, was sie wollte und was du gewählt hast — daraus lernt die KI danach.',
      run2Focus: 'Links die Züge, in der Mitte die Karte. Klick einen Zug an: Rechts zeigt das Zug-Detail seine nächste Weiche und die Optionen dort. Im Co-Learning sind sie neutral — die KI markiert ihre Wahl nicht.',
      run2Role: 'Du disponierst neben der KI. Wo du einen Zug in Ruhe lässt, fährt ihn die KI.',
      run2Control: 'Einen Zug wählen und seine Option an der nächsten Weiche bestimmen',
      aiPickHint: 'Klick den Zug an, der auf die Weiche Weesen zufährt. Rechts zeigt das Zug-Detail seine nächste Weiche und die Optionen — neutral, ohne die Wahl der KI.',
      interveneTitle: 'Eingreifen',
      interveneHint: 'Wähl die Option, die den Einspurabschnitt frei hält. Das ist ein Eingriff: Was die KI gesehen hat, was sie wollte und was du gewählt hast, wird festgehalten.',
      run1Role: 'Beobachter:in. Greif nicht ein — dieser Lauf zeigt, was die KI allein macht.',
    },
  },
  director: {
    en: {
      eyebrow: 'MARL lab · Director',
      title: 'Supervise the AI — and retrain it',
      lead: 'A learned AI drives three trains through the single-track section on the Walensee, on its own. Left alone it gets one of the three home; the other two block each other. In this tour you go once round the loop of learning between human and AI: watch the AI, overrule it, train it on what you did, and see whether it learned.',
      modeHeading: 'Director',
      modeBody: 'In Director the AI drives on its own and you supervise. For a train you pick, Train detail says what the AI will take at its next switch; where that is about to go wrong, you overrule it. The AI Track Record counts how often you took over.',
      run2Item: 'Run 2 · With you: the same scenario. The AI drives; at the Weesen switch, overrule it where it is about to go wrong.',
      run2Tagline: 'The same scenario. The AI drives — you overrule it where it goes wrong.',
      run2WhatHappens: 'The same three trains, the same AI, driving on its own. This time you supervise: pick a train, read what the AI will take at its next switch, and choose another option if that is wrong. Each time you overrule it, the system writes down what the AI saw, what it wanted and what you chose — that is what the AI learns from afterwards.',
      run2Focus: 'The map in the middle. Click a train on the map: on the right, Train detail shows its next switch and the line “The AI will take …”. There is no train list in Director — the AI owns the single trains.',
      run2Role: 'Supervisor. The AI drives every train; you take over only where it is about to go wrong.',
      run2Control: 'Pick a train and overrule the AI at its next switch',
      aiPickHint: 'Click the train heading for the Weesen switch on the map. Train detail on the right says what the AI will take there.',
      interveneTitle: 'Overrule',
      interveneHint: 'If the AI’s choice would block the single track, choose the option that keeps it free. That is one intervention: what the AI saw, what it wanted and what you chose are recorded.',
      run1Role: 'Supervisor, hands off. Do not overrule anything — this run shows what the AI does on its own.',
    },
    de: {
      eyebrow: 'MARL-Labor · Director',
      title: 'Die KI überwachen — und neu trainieren',
      lead: 'Eine gelernte KI fährt drei Züge selbständig durch den Einspurabschnitt am Walensee. Allein bringt sie einen der drei ans Ziel; die anderen zwei blockieren sich gegenseitig. In dieser Tour gehst du einmal durch den Kreislauf, in dem Mensch und KI voneinander lernen: Du schaust der KI zu, überstimmst sie, trainierst sie auf das, was du getan hast, und schaust, ob sie es gelernt hat.',
      modeHeading: 'Director',
      modeBody: 'Im Director fährt die KI selbständig, und du überwachst. Für einen Zug, den du anklickst, sagt das Zug-Detail, was die KI an seiner nächsten Weiche nehmen wird; wo das schiefgehen würde, überstimmst du sie. Der AI Track Record zählt, wie oft du übernommen hast.',
      run2Item: 'Lauf 2 · Mit dir: dasselbe Szenario. Die KI fährt; an der Weiche Weesen überstimmst du sie, wo sie falsch abbiegen will.',
      run2Tagline: 'Dasselbe Szenario. Die KI fährt — du überstimmst sie, wo sie falsch liegt.',
      run2WhatHappens: 'Dieselben drei Züge, dieselbe KI, die selbständig fährt. Diesmal überwachst du: Wähl einen Zug, lies, was die KI an seiner nächsten Weiche nehmen wird, und wähl eine andere Option, wenn das falsch ist. Jedes Mal, wenn du sie überstimmst, hält das System fest, was die KI gesehen hat, was sie wollte und was du gewählt hast — daraus lernt die KI danach.',
      run2Focus: 'In der Mitte die Karte. Klick einen Zug auf der Karte an: Rechts zeigt das Zug-Detail seine nächste Weiche und die Zeile «Die KI nimmt …». Eine Zugliste gibt es im Director nicht — die einzelnen Züge führt die KI.',
      run2Role: 'Aufsicht. Die KI fährt alle Züge; du übernimmst nur, wo sie falsch liegen würde.',
      run2Control: 'Einen Zug wählen und die KI an seiner nächsten Weiche überstimmen',
      aiPickHint: 'Klick auf der Karte den Zug an, der auf die Weiche Weesen zufährt. Rechts sagt das Zug-Detail, was die KI dort nehmen wird.',
      interveneTitle: 'Überstimmen',
      interveneHint: 'Würde die Wahl der KI den Einspurabschnitt blockieren, wähl die Option, die ihn frei hält. Das ist ein Eingriff: Was die KI gesehen hat, was sie wollte und was du gewählt hast, wird festgehalten.',
      run1Role: 'Aufsicht, Hände weg. Überstimm nichts — dieser Lauf zeigt, was die KI allein macht.',
    },
  },
};

/** Shared by both loops, per language. */
const SHARED = {
  en: {
    byline: 'About 15 minutes · three runs of the same scenario · no survey',
    policyHeading: 'What a learned policy is',
    policyBody: 'The AI here is not a set of rules someone wrote. It is a small neural network that learned to drive trains by trial and error in simulation (reinforcement learning). It comes pretrained: someone else trained it before you meet it. It decides for every train at every step — and it can be wrong in situations it rarely met.',
    planHeading: 'What you will do',
    run1Item: 'Run 1 · The AI alone: watch, change nothing. Note where it goes wrong.',
    trainItem: 'Train the AI: on your interventions, in a few seconds, with one setting — how much the AI should stay as it was. A short check then compares your AI with the pretrained one.',
    run3Item: 'Run 3 · Your AI: the same scenario driven by the AI you trained — with a breakdown on top, in the single-track section. Does it take the switch by itself, and does it cope with what it never practised?',
    proceed: 'To run 1',
    run1Wp: 'MARL lab · Run 1 of 3',
    run1Title: 'The AI alone',
    run1Tagline: 'Watch only. The pretrained AI drives all three trains.',
    run1Focus: 'The map in the middle: watch the trains approach the single-track section. On the right, the AI Track Record names the policy that drives.',
    run1Control: ['Start, pause and resume the run', 'Change the tempo', 'End the run once no train moves any more'],
    run1Watch: [
      'Which train the AI sends into the single track first',
      'Whether two trains block each other (a deadlock: neither can move on)',
      'How many of the three trains arrive',
    ],
    run1Goal: 'Know where the AI goes wrong, so that in run 2 you know where to step in.',
    run2Wp: 'MARL lab · Run 2 of 3',
    run2Title: 'With you',
    run2ControlMore: ['Pause to think — the run waits for you', 'End the run'],
    run2Watch: [
      'The train coming to the Weesen (WN) switch before the single track: which way keeps the section free?',
      'After the run: with you against the AI alone, in the AI Track Record',
    ],
    run2Goal: 'Get all three trains home — with as few interventions as needed.',
    run3Wp: 'MARL lab · Run 3 of 3',
    run3Title: 'Your AI',
    run3Tagline: 'The AI you trained drives — and this time a train breaks down in the single track.',
    run3WhatHappens: 'The same trains and timetable, but now it is your AI — the pretrained AI after you trained it on your interventions — and one thing is new: the train coming from Walenstadt has a door fault and stands for 8 steps inside the single-track section. So this run is not like-for-like with run 2: a worse result here does not mean the training failed, only that the situation is harder. You may still step in; the AI Track Record counts how often you had to. If you did not train it, the pretrained AI drives again.',
    run3Focus: 'The map, and on the right the AI Track Record: the policy line names your AI (Lab: tour-…).',
    run3Role: 'Observer first. Step in only if your AI goes wrong.',
    run3Watch: [
      'Does it now take the Weesen switch the way you did?',
      'The breakdown: the train from Walenstadt stops in the single track for 8 steps. Does your AI wait it out, or do trains block each other?',
      'How many trains arrive — with the breakdown on top, so compare with care',
    ],
    run3Goal: 'See what one correction taught the AI — and what it did not.',
    watchTitle: 'Watch the AI',
    watchHint: 'Start the run and watch. Change nothing; end the run when no train moves any more.',
    pickTitle: 'Look at a train',
    compareTitle: 'Compare',
    compareHint: 'Let the run finish, or end it. The AI Track Record compares the run with you against the AI alone.',
    trainTitle: 'Train the AI',
    trainHint: 'In the debrief: choose how much the AI should stay as it was, train, and read the check.',
    replayTitle: 'Drive with your AI',
    replayHint: 'Start the run. Does your AI take the switch by itself — and cope with the breakdown of the train from Walenstadt in the single track, which is new in this run? End the run when no train moves any more.',
    closingEyebrow: 'MARL lab · what happened',
    closingTitle: 'You taught the AI — a little',
    closingLead: 'You went once round the loop: the AI drove, you corrected it, it learned from your correction, and it drove again.',
    closing: [
      {
        heading: 'What the training did',
        body: 'The method is called HG-DAgger (human-gated imitation learning). Every time you stepped in, the system kept the situation the AI saw and the choice you made. Training nudges the network so that it picks your choice in those situations. A few seconds are enough because there are only a handful of examples.',
      },
      {
        heading: 'Why the setting matters',
        body: 'From a single correction the AI could simply overwrite what it knew. “How much should the AI stay as it was” holds it close to its old behaviour everywhere else (technically a KL term). Measured on this scenario: with “medium”, one correction solves the conflict and the scenarios it never saw stay as good as before; with “a little”, the same correction can break a scenario it used to handle. Train with both and the check shows the difference.',
      },
      {
        heading: 'Agreeing is not operating better',
        body: 'That your AI now picks what you picked says only that it learned you. Whether that is better operation shows only when it drives on its own — that is why the check also runs scenarios it never saw.',
      },
      {
        heading: 'Going further, on the command line',
        items: [
          'cd backend',
          'python -m lab.marl.finetune_interventions --name corrected --kl-weight 3',
          'python -m lab.marl.evaluate --checkpoint lab/checkpoints/corrected.pt',
          'Plan and measurements: docs/plans/marl-lab-plan.md and docs/plans/marl-lab-tour.md',
        ],
      },
    ] as BriefingSection[],
    disclaimer: 'This is a prototype: the look and wording of the panels are not final. A model trained in the tour is deleted after a day.',
    sources: 'Pretrained policy network: a public Flatland starter kit (MIT; source in the Algorithm Gallery). Method: Kelly et al., HG-DAgger (2019). Part of AI4REALNET (EU Horizon Europe).',
  },
  de: {
    byline: 'Etwa 15 Minuten · drei Läufe desselben Szenarios · kein Fragebogen',
    policyHeading: 'Was eine gelernte Policy ist',
    policyBody: 'Die KI hier ist kein Regelwerk, das jemand geschrieben hat. Sie ist ein kleines neuronales Netz, das in der Simulation durch Versuch und Irrtum gelernt hat, Züge zu fahren (Reinforcement Learning). Sie kommt vortrainiert: Jemand anderes hat sie trainiert, bevor du sie triffst. Sie entscheidet für jeden Zug in jedem Schritt — und sie kann danebenliegen, wo sie eine Lage selten erlebt hat.',
    planHeading: 'Was du machst',
    run1Item: 'Lauf 1 · Die KI allein: zuschauen, nichts ändern. Merk dir, wo sie falsch liegt.',
    trainItem: 'Die KI trainieren: auf deine Eingriffe, in ein paar Sekunden, mit einer Einstellung — wie stark die KI bleiben soll, wie sie war. Ein kurzer Check vergleicht danach deine KI mit der vortrainierten.',
    run3Item: 'Lauf 3 · Deine KI: dasselbe Szenario, gefahren von der KI, die du trainiert hast — und dazu eine Störung im Einspurabschnitt. Nimmt sie die Weiche von selbst, und kommt sie mit etwas zurecht, das sie nie geübt hat?',
    proceed: 'Zu Lauf 1',
    run1Wp: 'MARL-Labor · Lauf 1 von 3',
    run1Title: 'Die KI allein',
    run1Tagline: 'Nur zuschauen. Die vortrainierte KI fährt alle drei Züge.',
    run1Focus: 'Die Karte in der Mitte: Schau, wie sich die Züge dem Einspurabschnitt nähern. Rechts nennt der AI Track Record die Policy, die fährt.',
    run1Control: ['Den Lauf starten, pausieren und fortsetzen', 'Das Tempo ändern', 'Den Lauf beenden, sobald sich kein Zug mehr bewegt'],
    run1Watch: [
      'Welchen Zug die KI zuerst in den Einspurabschnitt schickt',
      'Ob sich zwei Züge gegenseitig blockieren (ein Deadlock: keiner kommt mehr weiter)',
      'Wie viele der drei Züge ankommen',
    ],
    run1Goal: 'Wissen, wo die KI falsch liegt, damit du in Lauf 2 weisst, wo du eingreifen willst.',
    run2Wp: 'MARL-Labor · Lauf 2 von 3',
    run2Title: 'Mit dir',
    run2ControlMore: ['Pausieren, um nachzudenken — der Lauf wartet auf dich', 'Den Lauf beenden'],
    run2Watch: [
      'Den Zug, der vor dem Einspurabschnitt auf die Weiche Weesen (WN) zufährt: Welcher Weg hält den Abschnitt frei?',
      'Nach dem Lauf: mit dir gegen die KI allein, im AI Track Record',
    ],
    run2Goal: 'Alle drei Züge ans Ziel bringen — mit so wenigen Eingriffen wie nötig.',
    run3Wp: 'MARL-Labor · Lauf 3 von 3',
    run3Title: 'Deine KI',
    run3Tagline: 'Die KI, die du trainiert hast, fährt — und diesmal bleibt ein Zug im Einspurabschnitt stehen.',
    run3WhatHappens: 'Dieselben Züge und derselbe Fahrplan, aber jetzt fährt deine KI — die vortrainierte KI, nachdem du sie auf deine Eingriffe trainiert hast — und etwas ist neu: Der Zug aus Walenstadt hat eine Türstörung und steht 8 Schritte lang im Einspurabschnitt. Dieser Lauf ist darum nicht direkt mit Lauf 2 vergleichbar: Ein schlechteres Ergebnis heisst nicht, dass das Training nichts gebracht hat, nur dass die Lage schwieriger ist. Eingreifen darfst du weiterhin; der AI Track Record zählt, wie oft du musstest. Hast du nicht trainiert, fährt wieder die vortrainierte KI.',
    run3Focus: 'Die Karte, und rechts der AI Track Record: Die Zeile zur Policy nennt deine KI (Lab: tour-…).',
    run3Role: 'Zuerst beobachten. Greif nur ein, wenn deine KI falsch liegt.',
    run3Watch: [
      'Nimmt sie die Weiche Weesen jetzt so, wie du es getan hast?',
      'Die Störung: Der Zug aus Walenstadt steht 8 Schritte im Einspurabschnitt. Wartet deine KI sie ab, oder blockieren sich Züge?',
      'Wie viele Züge ankommen — mit der Störung obendrauf, also vorsichtig vergleichen',
    ],
    run3Goal: 'Sehen, was eine einzige Korrektur der KI beigebracht hat — und was nicht.',
    watchTitle: 'Der KI zuschauen',
    watchHint: 'Starte den Lauf und schau zu. Ändere nichts; beende den Lauf, wenn sich kein Zug mehr bewegt.',
    pickTitle: 'Einen Zug anschauen',
    compareTitle: 'Vergleichen',
    compareHint: 'Lass den Lauf zu Ende laufen oder beende ihn. Der AI Track Record vergleicht den Lauf mit dir gegen die KI allein.',
    trainTitle: 'Die KI trainieren',
    trainHint: 'In der Auswertung: Wähl, wie stark die KI bleiben soll, wie sie war, trainiere und lies den Check.',
    replayTitle: 'Mit deiner KI fahren',
    replayHint: 'Starte den Lauf. Nimmt deine KI die Weiche von selbst — und kommt sie mit der Störung des Zugs aus Walenstadt im Einspurabschnitt zurecht, die in diesem Lauf neu ist? Beende den Lauf, wenn sich kein Zug mehr bewegt.',
    closingEyebrow: 'MARL-Labor · was passiert ist',
    closingTitle: 'Du hast der KI etwas beigebracht — ein bisschen',
    closingLead: 'Du bist einmal durch den Kreislauf gegangen: Die KI ist gefahren, du hast sie korrigiert, sie hat aus deiner Korrektur gelernt und ist nochmals gefahren.',
    closing: [
      {
        heading: 'Was das Training gemacht hat',
        body: 'Die Methode heisst HG-DAgger (Imitationslernen, bei dem der Mensch eingreift). Jedes Mal, wenn du eingegriffen hast, hat das System die Lage festgehalten, die die KI gesehen hat, und deine Wahl. Das Training verschiebt das Netz so, dass es in diesen Lagen deine Wahl trifft. Ein paar Sekunden reichen, weil es nur eine Handvoll Beispiele sind.',
      },
      {
        heading: 'Warum die Einstellung zählt',
        body: 'Aus einer einzigen Korrektur könnte die KI einfach überschreiben, was sie konnte. «Wie stark soll die KI bleiben, wie sie war» hält sie überall sonst nahe an ihrem alten Verhalten (technisch ein KL-Term). Gemessen auf diesem Szenario: Mit «Mittel» löst eine Korrektur den Konflikt, und die Szenarien, die sie nie gesehen hat, bleiben so gut wie vorher; mit «Wenig» kann dieselbe Korrektur ein Szenario kaputt machen, das sie vorher schaffte. Trainier mit beiden, und der Check zeigt den Unterschied.',
      },
      {
        heading: 'Übereinstimmen ist nicht besser fahren',
        body: 'Dass deine KI jetzt wählt, was du gewählt hast, sagt nur, dass sie dich gelernt hat. Ob das besser fährt, zeigt sich erst, wenn sie allein fährt — darum fährt der Check auch Szenarien, die sie nie gesehen hat.',
      },
      {
        heading: 'Weitermachen, auf der Kommandozeile',
        items: [
          'cd backend',
          'python -m lab.marl.finetune_interventions --name corrected --kl-weight 3',
          'python -m lab.marl.evaluate --checkpoint lab/checkpoints/corrected.pt',
          'Plan und Messungen: docs/plans/marl-lab-plan.md und docs/plans/marl-lab-tour.md',
        ],
      },
    ] as BriefingSection[],
    disclaimer: 'Das ist ein Prototyp: Aussehen und Texte der Panels sind nicht final. Ein Modell, das in der Tour trainiert wurde, wird nach einem Tag gelöscht.',
    sources: 'Vortrainiertes Policy-Netz: ein öffentliches Starterkit von Flatland (MIT; Quelle in der Algorithmen-Galerie). Methode: Kelly et al., HG-DAgger (2019). Teil von AI4REALNET (EU Horizon Europe).',
  },
} as const;

/** Run 1 summarises, run 2 trains, run 3 summarises. */
const LEG_DEBRIEF: DebriefSectionId[][] = [['shift-summary'], ['lab-train'], ['shift-summary']];

function marlLabBriefing(mode: MarlMode, lang: Lang): TourBriefing {
  const t = SHARED[lang];
  const m = MODE_TEXT[mode][lang];
  const base = { mode, labels: LABELS[lang], note: NOTE[lang] } as const;
  const run1: ModeIntro = {
    ...base,
    wp: t.run1Wp,
    title: t.run1Title,
    tagline: t.run1Tagline,
    whatHappens: SITUATION[lang],
    focusView: t.run1Focus,
    yourRole: m.run1Role,
    whatYouCanControl: [...t.run1Control],
    watchFor: [...t.run1Watch],
    goal: t.run1Goal,
  };
  const run2: ModeIntro = {
    ...base,
    wp: t.run2Wp,
    title: t.run2Title,
    tagline: m.run2Tagline,
    whatHappens: m.run2WhatHappens,
    focusView: m.run2Focus,
    yourRole: m.run2Role,
    whatYouCanControl: [m.run2Control, ...t.run2ControlMore],
    watchFor: [...t.run2Watch],
    goal: t.run2Goal,
  };
  const run3: ModeIntro = {
    ...base,
    wp: t.run3Wp,
    title: t.run3Title,
    tagline: t.run3Tagline,
    whatHappens: t.run3WhatHappens,
    focusView: t.run3Focus,
    yourRole: t.run3Role,
    whatYouCanControl: [m.run2Control, ...t.run2ControlMore],
    watchFor: [...t.run3Watch],
    goal: t.run3Goal,
  };
  const guide: TourGuideStep[] = [
    { id: 'watch-ai', loop: 'operational', leg: 0, title: t.watchTitle, hint: t.watchHint },
    { id: 'ai-pick', loop: 'operational', leg: 1, title: t.pickTitle, hint: m.aiPickHint, panelType: 'agent-inspector' },
    { id: 'intervene', loop: 'operational', leg: 1, title: m.interveneTitle, hint: m.interveneHint, panelType: 'agent-inspector' },
    { id: 'compare', loop: 'operational', leg: 1, title: t.compareTitle, hint: t.compareHint, panelType: 'ai-track-record' },
    { id: 'train', loop: 'learning', leg: 1, title: t.trainTitle, hint: t.trainHint, afterEpisode: true },
    { id: 'replay', loop: 'operational', leg: 2, title: t.replayTitle, hint: t.replayHint },
  ];
  return {
    id: `marl-lab-${mode}-${lang}`.replace('co-learning', 'colearning'),
    language: lang,
    // Ziegelbrücke to Walenstadt: both spawns, the shared track after Weesen
    // and the single track where the conflict sits.
    mapFocusCols: [69, 126],
    mapTrainLabels: true,
    autoStart: true,
    debrief: true,
    legDebriefSections: LEG_DEBRIEF,
    guide,
    modeIntros: { [mode]: run1 },
    legIntros: [run1, run2, run3],
    opening: {
      eyebrow: m.eyebrow,
      title: m.title,
      lead: m.lead,
      byline: t.byline,
      sections: [
        { heading: t.policyHeading, body: t.policyBody },
        { heading: t.planHeading, items: [t.run1Item, m.run2Item, t.trainItem, t.run3Item], ordered: true },
        { heading: m.modeHeading, body: m.modeBody },
      ],
      proceedLabel: t.proceed,
    },
    closing: {
      eyebrow: t.closingEyebrow,
      title: t.closingTitle,
      lead: t.closingLead,
      sections: [...t.closing],
      disclaimer: t.disclaimer,
      sources: t.sources,
    },
  };
}

export const MARL_LAB_BRIEFINGS: TourBriefing[] = [
  marlLabBriefing('co-learning', 'en'),
  marlLabBriefing('co-learning', 'de'),
  marlLabBriefing('director', 'en'),
  marlLabBriefing('director', 'de'),
];
