# Zukunftsbild und Umsetzungsauftrag
## Lernender Human-AI-Teaming-Partner für komplexe Planung
 
--- 

## 1. Zukunftsbild

Wir entwickeln ein System, das Menschen bei wiederkehrenden, komplexen Planungsentscheidungen unterstützt. Das System zeigt nicht nur eine einzelne Empfehlung, sondern mehrere mögliche Vorgehensweisen und deren erwartete Folgen.

Mehrere Algorithmen bearbeiten dieselbe Situation aus unterschiedlichen Perspektiven. Ein Verfahren kann beispielsweise vorgegebene Fahrwege priorisieren, ein anderes kurze Wege suchen, ein weiteres als einfache Vergleichsbasis zufällig handeln. Eine lernende PPO-Policy versucht, aus vergleichbaren Situationen, Simulationsergebnissen und ausgeführten Aktionen bessere Entscheidungen abzuleiten und die erwartete Wirkung einer Aktion zu bewerten. Der Mensch kann sich ebenfalls aktiv einbringen: Er kann eine eigene Aktion ausführen oder zunächst simulativ prüfen lassen, was passieren könnte. Das System kann dann einschätzen, wie erfolgversprechend die Aktion unter den definierten Kriterien ist und welche Alternativen ebenfalls möglich wären.

Die menschliche Entscheidung bleibt eine eigene Perspektive. Sie wird nicht automatisch als Fehler, Trainingslabel oder Reward interpretiert.

Der Anwender bleibt Entscheider. Er kann Vorschläge annehmen, ablehnen oder übersteuern. Das System macht Unsicherheit, Zielkonflikte und mögliche Folgen sichtbar, ohne die menschliche Entscheidung automatisch als richtig oder falsch zu bewerten.

---

## 2. Was der Anwender erleben soll

Für jede relevante Entscheidung soll der Anwender verständlich sehen können:

- welche Algorithmen welche Option vorgeschlagen haben;
- welche weiteren gültigen Optionen existieren;
- wie jede Option in einer Simulation abschneidet;
- welche Zielkonflikte bestehen, zum Beispiel Pünktlichkeit gegenüber Wartezeit;
- wie sicher oder unsicher die Prognose ist;
- ob die aktuelle Entscheidung von ähnlichen erfolgreichen Planungen abweicht.

Wenn genügend historische Daten vorhanden sind, kann das System beispielsweise fragen:

> In 50 vergleichbaren Situationen wurde zuerst Zug A priorisiert. Deine aktuelle Entscheidung priorisiert Zug B. Was ist diesmal anders?

Die Frage ist als Reflexionshilfe zu verstehen, nicht als Vorwurf. Der Anwender kann erklären, welche Information oder Randbedingung das System nicht berücksichtigt hat.
 

---

## 3. Bewertungsquellen klar trennen

Die Umsetzung muss drei unterschiedliche Arten von Bewertung unterscheiden:

### 3.1 Simulierte Wirkung

Eine Aktion wird in einer sicheren Kopie der Umgebung ausgeführt. Die Simulation liefert eine begrenzte Prognose über Ankunft, Verspätung, Wartezeit, Konflikte und Deadlocks.

Die Simulation ist eine Schätzung. Sie ist keine Garantie für den realen Verlauf, insbesondere bei Störungen oder unvollständigen Zustandsdaten.

### 3.2 Historischer Vergleich

Eine aktuelle Entscheidung kann mit kontextuell ähnlichen historischen Fällen verglichen werden. 
 
Der historische Vergleich ist im aktuellen Prototypen noch nicht implementiert. Im Online-PPO-Lernpfad bleibt die Datenherkunft dagegen getrennt: Eigene ausgeführte On-Policy-Rollouts liefern die PPO-Policy- und Value-Trainingsdaten; Fork-Simulationen können selektive Distillation-Ziele und Count-Estimator-Beispiele liefern. Policy-Vorschläge werden nicht direkt als PPO-Trainingsbeispiele verwendet. Ob und wie Prognosen später in einen historischen Vergleich oder weitere Lernverfahren einfliessen sollen, muss ein eigenes Experiment zeigen.

Dabei muss zunächst geprüft werden, wie verständlich und zuverlässig sich Prognoseergebnisse im Vergleich zu real beobachteten Ergebnissen bewerten lassen und ob diese Bewertung auf andere Situationen übertragbar ist. Falls sich die Prognosen als ausreichend belastbar erweisen, könnten sie helfen, das Problem der Datensparsamkeit zu reduzieren: Werden ausschliesslich reale Ergebnisse zugelassen, benötigt das Training sehr lange, weil keine Zeitbeschleunigung möglich ist. Können dagegen geeignete simulierte oder prognostizierte Ergebnisse kontrolliert einbezogen werden, lassen sich deutlich schneller grössere Datenmengen erzeugen.

---

## 4. Mehrere Algorithmen als gleichberechtigte Perspektiven

Die Architektur unterstützt aktuell mehrere Policy-Typen, ohne eine einzelne Policy als automatisch richtig zu behandeln:

- regelbasierte Dispositon/Planung oder Deadlock-Vermeidung;
- kürzester oder effizientester Weg;
- bestehende Solver oder Baselines;
- Zufallsverfahren als technische Vergleichsbasis;
- gelernte Policies;
- menschliche Aktion als eigene beobachtete Perspektive.

Die Auswahl der besten Aktion erfolgt anhand expliziter Kriterien und nicht allein anhand einer Policy-Konfidenz - resp. der Mensch kann seine Idee immer durch übersteuern dem System vorgeben. Der Mensch entscheidet, das System bewertet. Falls der Mensch nicht eingreift, läuft alles automatisiert ab.  

---

## 5. Lernsprinzipien

Die Datenquellen bleiben getrennt und auditierbar:

- eigene On-Policy-Rollouts für PPO;
- Vorschläge anderer Policies für Vergleich, Ranking und Evaluation;
- simulierte Gegenfakten für Kandidatenbewertung und Distillation;


Eine nicht ausgeführte Aktion erhält keinen beobachteten Reward. 

Der PPO-Critic, der PPO-Reward und der gewichtete Simulationsscore müssen im Datenmodell und in der Benutzeroberfläche unterscheidbar bleiben. Sie beantworten unterschiedliche Fragen:

- PPO-Reward: Was hat die lernende Policy in ihrem On-Policy-Rollout erhalten?
- Critic/Value: Welchen erwarteten Return schätzt das Modell für den Zustand beziehungsweise die Aktion?
- Simulationsscore: Wie bewertet die definierte Multi-Objective-Funktion eine getestete Alternative?


---

## 6. Interaktion und Human Factors

Das System muss drei Nutzungsweisen unterstützen:

### Empfehlung

Die AI schlägt vor. Der Mensch entscheidet.

### Co-Learning

Die AI stellt Optionen, Prognosen und Rückfragen bereit. Der Mensch vergleicht, entscheidet und kann seine Gründe reflektieren.

### Director

Die AI darf innerhalb expliziter Grenzen autonomer handeln. Der Mensch überwacht, setzt Grenzen und kann jederzeit eingreifen.

Für alle Modi gelten:

- Der Anwender kann eine AI-Aktion übersteuern.
- Unsicherheit und Datenbasis der Bewertung werden sichtbar gemacht.
- Jede Aktion kann mittels Simulationscore oder PPO-Policy score / Actor/Critic bewertet werden
- Rückfragen sind neutral und nicht beschämend formuliert.
- Feedback ist optional und wird nicht als Leistungsbewertung dargestellt.
- Persönliche Daten und Begründungen werden nur zweckgebunden und nachvollziehbar gespeichert.
- Der Mensch bleibt für die fachliche Freigabe und die Verantwortung zuständig, solange keine anders definierte Betriebsfreigabe besteht.


---

## 7. Erwartungen und Verantwortungen nach Zielgruppe

### Management

Management erhält eine Entscheidungsgrundlage für einen begrenzten Pilot, kein Versprechen eines fertigen autonomen Produkts. Vor einer Investitions- oder Betriebsentscheidung müssen Nutzen, Kosten, Risiken, Datenbedarf, Rechenzeit, Integrationsaufwand und Go-/No-Go-Kriterien dokumentiert sein.

Ein erfolgreicher Flatland-Lauf beweist weder Produktivität noch Return on Investment im Bahnbetrieb. Er zeigt zunächst, dass ein definierter Lern- und Vergleichskreislauf in einem definierten Labor funktioniert.

### Data Scientists

Data Scientists erhalten getrennte Datenquellen, reproduzierbare Splits, versionierte Features, nachvollziehbare Rewards und definierte Evaluationsprotokolle. Sie müssen erkennen können, ob ein Ergebnis aus On-Policy-Lernen, Simulation, historischem Replay oder menschlichem Verhalten stammt.

Feedback darf nicht ohne Prüfung als Label verwendet werden. Labelqualität, Verzerrungen, Selektionsprozesse und fachliche Freigabe müssen dokumentiert werden. Jede neue Lernquelle braucht eine Hypothese, eine Baseline und eine kontrollierte Evaluation.

### Software- und Systemarchitekten

Architekten müssen die Verantwortungsgrenzen zwischen Szenariozustand, Policy Registry, OnlineLearner, Fork-Simulation, Archiv, Retrieval, UI und Audit-Log festlegen. Datenverträge müssen Herkunft, Zeitstempel, Policy-Version, Szenarioversion, Zufallsseed, Zieldefinition, Ergebnisstatus und Unsicherheit enthalten.

Die Architektur muss Wiederholbarkeit, Fehlertoleranz, Versionierung, Zugriffskontrolle, Beobachtbarkeit und Rollback unterstützen. Ein Ausfall von Archiv, Retrieval oder einer einzelnen Policy darf nicht zu einer stillen Empfehlung oder unkontrollierten autonomen Aktion führen.

### Disponenten und Anwender

Anwender erhalten Optionen und nachvollziehbare Folgen, keine Black-Box-Anweisung. Sie müssen eine Empfehlung ablehnen, eine eigene Aktion ausführen, eine Begründung ergänzen und einen historischen Vergleich als nicht passend markieren können.

Die Interaktion muss auch dann sinnvoll bleiben, wenn keine Policy, keine Simulation oder kein historischer Vergleich verfügbar ist. In diesem Fall wird die fehlende Grundlage klar angezeigt und die menschliche Entscheidung nicht künstlich gerankt.

### Human Factors und Psychologie

Der Pilot muss prüfen, ob Vertrauen, mentale Belastung, Automationsbias, Verantwortungsgefühl, Erklärbarkeit und Lernnutzen tatsächlich verbessert werden. Ein häufiger Klick auf «Akzeptieren» ist kein Beweis für Vertrauen oder bessere Entscheidungen.

Erhebungen und Feedback sollen freiwillig, zweckgebunden und getrennt von einer individuellen Leistungsbeurteilung sein. Die Gestaltung muss Dissens ermöglichen und darf keine Beschämung oder unklare Verantwortungsverschiebung erzeugen.

---

## 8. Technische Ausbaustufen

### Aktueller Implementierungsstand: v0 Online-PPO-Inspector

Der aktuelle vertikale Slice ist als Experiment und nicht als Produktionsnachweis
einzuordnen. Er umfasst den Walensee-Ansatz im Online-PPO-Training und verwendet
`lab:online-ppo` als stabile, unabhängige PPO-v2-Evaluationspolicy. Die laufende
Policy treibt eine gemeinsame Fork-Simulation der Umgebung. Für jeden aktiven Zug
wird die Beobachtung an seinem eigenen nächsten Entscheidungspunkt erfasst; die
Züge müssen daher nicht gleichzeitig an derselben Stelle der Simulation ankommen.

An diesem Entscheidungspunkt bewertet PPO2 alle zulässigen sichtbaren Aktionen.
Die Agenteninspektion zeigt die Aktionswerte, die beste bewertete Aktion, die
tatsächlich von der laufenden Simulation gewählte Aktion und die Zeit bis zum
nächsten Entscheidungspunkt. Abgeschlossene Züge werden als `done` behandelt und
nicht weiter bewertet. Nicht zulässige Aktionen bleiben als solche kenntlich und
werden nicht als normale fehlende Werte dargestellt.

Die vier Aktionswerte sind direkt bedienbar. Ein Klick setzt einen menschlichen
Override über denselben Toggle-/Entscheidungslog wie die Aktion am Zug in der Map;
ein erneuter Klick auf die aktive Aktion hebt den Override wieder auf. Ein
separater Reset am Zeilenende löscht den Override ebenfalls. Diese Bedienung
ändert nicht automatisch PPO-On-Policy-Daten oder einen beobachteten Reward.

Die aktuelle Wertanzeige ist eine begrenzte Critic-basierte Ein-Schritt-Schätzung
der Form $Q(s,a) \approx r + \gamma V(s')$. Sie ist daher kein vollständiger
langfristiger Q-Wert und darf nicht mit PPO-Reward oder dem späteren
Multi-Objective-Simulationsscore gleichgesetzt werden.

#### Bedeutung der Werte in der Agententabelle

Die Tabelle zeigt die Q-/Value-Schätzung und zusätzlich den Advantage-Wert für
jede sichtbare Aktion. Beide Werte sind Prognosen aus dem PPO-Netz und keine
Garantie für den späteren Verlauf:

- **Q-Value $Q(s,a):** Schätzt, wie gut es aus dem aktuellen Zustand $s$ ist,
  die konkrete Aktion $a$ auszuführen. Im aktuellen v0 wird dafür eine
  Umgebungskopie einen Schritt mit dieser Aktion ausgeführt. Der unmittelbare
  Reward wird mit dem vom Critic geschätzten Folgezustand kombiniert:
  $Q(s,a) \approx r(s,a) + \gamma V(s')$.
- **State-Value $V(s)$:** Schätzt den erwarteten Wert des aktuellen Zustands,
  bevor eine konkrete Aktion ausgewählt wird. Er dient als Referenzwert für den
  Zustand und als Baseline im PPO-Training.
- **Advantage $A(s,a)$:** Zeigt, ob eine konkrete Aktion besser oder schlechter
  als diese Zustandsreferenz ist: $A(s,a) = Q(s,a) - V(s)$. Ein positiver Wert
  bedeutet „besser als erwartet“, ein negativer Wert „schlechter als erwartet“
  und ein Wert nahe $0$ „ungefähr wie erwartet“.

Die zusätzlichen Advantage-Spalten stehen am rechten Ende der Tabelle. Ein
Pluszeichen und die positive Farbe markieren einen positiven Advantage, ein
Minuszeichen und die Warnfarbe einen negativen Advantage. Die Anzeige vergleicht
damit Aktionen relativ zueinander; sie ist weder eine Konfidenz noch ein
beobachteter Reward. Wird eine Aktion nicht ausgeführt, bleibt ihr Wert eine
Gegenfaktenschätzung aus der Fork-Simulation.

#### Log-Likelihood, Entropie, Aktionserfahrung und Zählunsicherheit

Die Agententabelle ergänzt Q-Values und Advantages um vier getrennte Signale:

- **Log-Likelihood:** $\ln \pi(a\mid s)$ der ausgewählten sichtbaren Option,
  konditioniert auf alle aktuell gültigen HMI-Optionen. Die Einordnung vergleicht
  die Wahrscheinlichkeit mit einer Gleichverteilung über diese Optionen. Ein
  niedriger Wert bedeutet „für diese Policy unerwartet“, nicht „schlecht“.
- **Entropie:** $H(\pi)=-\sum_a p(a\mid s)\ln p(a\mid s)$ über dieselben
  gültigen Optionen, angezeigt in Nats. Hohe Entropie bedeutet eine breitere
  Verteilung; tiefe Entropie eine stärker konzentrierte Policy. Sie misst weder
  Aktionsqualität noch die Unsicherheit des Count-Estimators.
- **`NumberOfSeenActions(s,a)`:** Ein zusätzlicher PPO-Head schätzt für jede
  Rohaktion die logarithmierte Anzahl bisheriger Sichtungen. Ein begrenzter
  Zähler erzeugt die Trainingsziele. Er verwendet einen quantisierten
  Zustands-Key aus den 36 FastTreeObs-Features (auf 0,01 gerundet), der
  Aktionsmaske und der Aktion. Ein gespeicherter Count ist damit exakt für
  diesen quantisierten Key, nicht für jeden kontinuierlichen Rohzustand.
- **Erfahrungsprozent:** Die Anzahl $n$ wird auf $0$–$100\,\%$ abgebildet:
  $100\,n/(n+10)$. Zehn Sichtungen entsprechen 50 %. Bei einem bekannten
  quantisierten Key verwendet die Tabelle den Zähler; sonst den Mittelwert der
  drei Count-Heads als Schätzung für ähnliche Zustände. Das ist ein
  Vertrautheitssignal, keine Aktionsqualität und keine Erfolgswahrscheinlichkeit.
- **Zählunsicherheit:** Die drei Count-Heads werden mit unabhängigen
  Bootstrap-Stichproben trainiert. Die Anzeige kombiniert geringe Sichtungszahl
  und Head-Streuung:

  $$
  U=100\,\min\left(1,\max\left(\frac{1}{\sqrt{n+1}},\frac{\sigma}{n+1}\right)\right)
  $$

  $n$ ist der exakte Count oder Ensemble-Mittelwert; $\sigma$ ist die
  Standardabweichung der Count-Schätzungen nach Abbildung auf die sichtbare
  HMI-Option. Ab 50 % markiert die Tabelle „wenig Beobachtungen“, ab 20 % eine
  mittlere Unsicherheit, darunter eine geringere. Das ist eine konservative
  Heuristik, keine kalibrierte Wahrscheinlichkeit.

Ausgeführte PPO- und menschliche Aktionen sowie simulierte Gegenfaktualtests
werden als getrennte Quellen gezählt. Der Count-Head lernt aus beiden; die
Quellen bleiben im Checkpoint erhalten. Der kurze Hover-Text zeigt bei exakten
Zählungen ausgeführte und simulierte Sichtungen getrennt.
Simulierte Kandidaten werden dadurch nicht zu ausgeführten Aktionen oder
beobachtetem PPO-Reward. Simulationen reduzieren Datenlücken, beseitigen aber
keine Modell- oder Verteilungsverschiebung. Der Count-Head nutzt einen eigenen
maskierten Hilfsverlust; die On-Policy-Rollout-Regel von PPO bleibt bestehen.

#### Datenherkunft und selektive Distillation

Kurz zusammengefasst: Der Hintergrund-Learner sammelt und belohnt seine eigenen ausgeführten Aktionen für PPO. Vorschläge anderer Policies werden nur protokolliert und können Kandidaten für Forks liefern. Forks testen Kandidaten in Umgebungskopien; nur ein machbares Ergebnis, das die eigene Aktion um den konfigurierten Mindestabstand übertrifft, wird zum Distillation-Ziel. Ausgeführte und simulierte Erfahrungen trainieren den Count-Estimator getrennt vom PPO-Reward. Die Hover-Erklärungen im Learning Monitor erläutern den Fortschrittsbalken, die fünf Buffer-Zähler und die vier Quellenbereiche; die Zahlen zeigen gespeicherte Einträge, nicht automatisch den Inhalt des nächsten Mini-Batches.

Der Online-Learner fragt pro Umgebungsschritt die in `active_policies`
konfigurierten Vergleichs-Policies ab. Standardmässig sind dies
Deadlock Avoidance (DLA), Shortest Path und die vortrainierte Policy
`learned_ppo`; eine Random Policy gehört nicht zum Standard. Die Vorhersagen
werden mit ihrer Policy-ID im begrenzten Prediction-Buffer protokolliert. Sie
werden nicht direkt als PPO-Trainingsbeispiele verwendet.

Bei relevanten Entscheidungen werden in regelmässigen Abständen
Gegenfaktual-Forks ausgeführt. Kandidaten sind die Aktion des Online-Learners,
gültige Vorschläge der aktiven Policies, gegebenenfalls eine menschliche
Override-Aktion sowie gültige Aktionen, die keine Policy vorgeschlagen hat.
Jede Kandidatenaktion wird in einer eigenen Umgebungskopie getestet; die
Fortsetzung steuert die greedy Policy des Online-Learners. Die Auswahl richtet
sich nach dem simulierten Mehrziel-Score und der Machbarkeit, nicht nach der
Konfidenz der vorschlagenden Policy. Standardmässig startet die Fork-Prüfung
alle vier Umgebungsschritte, umfasst höchstens zwei Züge mit echter Wahl und
simuliert 20 Folgeschritte (`cf_every=4`, `cf_max_trains=2`, `cf_horizon=20`).

Das Verfahren ist damit **selektive Policy-Distillation**, nicht die
unkonditionierte Imitation aller abgefragten Policies. Sei
$\mathcal{C}_{\mathrm{feasible}}$ die Menge machbarer Fork-Kandidaten,
$S(s,a)$ ihr Simulationsscore und $a_{\mathrm{PPO}}$ die eigene Aktion des
Learners. Das beste Ziel ist

$$
a^* = \arg\max_{a \in \mathcal{C}_{\mathrm{feasible}}} S(s,a)
$$

und wird nur in den Distillation-Buffer aufgenommen, wenn
$a^* \ne a_{\mathrm{PPO}}$ und
$S(s,a^*) - S(s,a_{\mathrm{PPO}}) \geq \texttt{cf\_margin}$
(Standardwert $0{,}05$). Die Kreuzentropie auf diesen Zielaktionen ist ein
separater, gewichteter Hilfsterm. Menschliche Overrides folgen demselben
Simulationsprinzip und werden nur bei entsprechend besserem Ergebnis zu einem
Distillation-Ziel.

Der PPO-Policy- und Value-Loss verwenden dagegen ausschliesslich die vom
aktuellen Learner selbst gesampelten und ausgeführten On-Policy-Rollouts samt
ihrem Reward. Der Rollout-Buffer weist fremde oder veraltete Schritte zurück.
Ein dritter Lernpfad trainiert den Count-Head mit einem eigenen maskierten
Hilfsverlust: ausgeführte Aktionen und simulierte Fork-Aktionen sind als
`executed` beziehungsweise `simulated` markiert und werden nicht zu
PPO-Rewards umgedeutet.

Die Datenquellenansicht im Learning Monitor zählt Einträge in den aktuell
belegten, begrenzten Buffern: erfolgreiche Policy-Vorhersagen nach Policy-ID,
Distillation-Ziele nach den Quellen ihrer Kandidaten sowie Count-Beispiele
getrennt nach ausgeführt und simuliert. Bei einem Kandidaten, den mehrere
Policies vorgeschlagen haben, zählt die Quelle für jede dieser Policies; die
Quellensummen können deshalb grösser als die Zahl der Distillation-Ziele sein.
Das Status-JSON stellt diese Werte unter `data_sources.policy_predictions`,
`data_sources.distillation_targets` und `data_sources.experience_samples`
bereit. Diese Zähler beschreiben den gespeicherten Buffer-Bestand, nicht exakt
die Zusammensetzung des gerade gezogenen Mini-Batches. Der PPO-Rollout wird
separat über `buffers.ppo_rollout_buffer` als Learner-eigene On-Policy-Daten
ausgewiesen.

### Datenfluss des PPO2-Trainings

Der Online-Learner läuft als eigener Hintergrundprozess und erzeugt PPO-
Rollouts aus eigenen Episoden in Flatland. Vergleichs-Policies und
Counterfactual-Forks liefern getrennte Zusatzdaten. Die Szenarien werden aus
der Konfiguration gezogen; dazu gehören aktuell generierte Netze und der
Walensee-Ansatz `pf-ch-wn-wal-long-approach`. Das Diagramm trennt PPO-Rollout,
Policy-Vorhersagen, selektive Distillation und Count-Estimator:

```mermaid
flowchart LR
A["Flatland-Szenario<br/>Generator oder Walensee"] --> B["Umgebungszustand s"]
B --> C["Beobachtung<br/>Features + Aktionsmaske"]
C --> D["Actor-Critic PPO2<br/>Logits + Value V(s)"]
D --> E["Maskierte Verteilung<br/>Aktion a, log pi(a|s)"]
E --> F["Flatland env.step"]
F --> G["Shaped Reward r<br/>und nächster Zustand"]
G --> B
E --> H["On-Policy RolloutStep"]
G --> H
H --> I["PPO Rollout Buffer<br/>obs, mask, action, logp, value, reward"]
I --> J["Episode-Ende<br/>GAE Advantages + Returns"]
J --> K["Update<br/>PPO + Distillation-CE + Count-Loss"]
K --> L["Kandidatenversion"]
L --> M["Evaluation gegen stabile<br/>Version und Baseline"]
M --> N{"Sicher und besser?"}
N -->|ja| O["Stabile Version publizieren"]
N -->|nein| P["Weiterlernen oder Rollback"]
O --> Q["lab:online-ppo<br/>Checkpoint für Evaluation"]

C -.-> R["Aktive Policies abfragen<br/>DLA, Shortest Path, learned_ppo"]
R -.-> S["Prediction Buffer<br/>Policy-ID, Aktion, Konfidenz"]
E -.-> T["Kandidaten sammeln<br/>Learner + Vorschläge + übrige Aktionen"]
R -.-> T
U["Menschlicher Override"] -.-> T
T --> V["Fork-Simulationen<br/>Score und Machbarkeit"]
V -.->|nur besser als Learner| W["Distillation Buffer<br/>Quellen der Kandidaten"]
W -.->|gewichtete Kreuzentropie| K
F -.-> X["Ausgeführte Aktion"]
V -.-> Y["Simulierte Aktionen"]
X -.-> Z["Count-Buffer<br/>Quelle: executed"]
U -.-> Z
Y -.-> Z2["Count-Buffer<br/>Quelle: simulated"]
Z -.-> AA["3-Head Count-Estimator"]
Z2 -.-> AA
AA -.->|separater Count-Loss| K
```

Der Datenfluss im Einzelnen:

1. **Zustand und Beobachtung:** Das Flatland-Szenario liefert den aktuellen
  Zustand. Der Observation Builder erzeugt pro aktivem Zug die Feature-
  Beobachtung und eine Maske der zulässigen Aktionen.
2. **PPO-Entscheidung:** Das Actor-Critic-Modell berechnet Aktionslogits und
  den Critic-Wert $V(s)$. Nicht zulässige Aktionen werden maskiert. Aus der
  verbleibenden Verteilung werden Aktion, Log-Wahrscheinlichkeit und Value für
  den eigenen On-Policy-Rollout gespeichert.
3. **Ausführung und Reward:** Die Aktion wird in der Umgebung ausgeführt. Der
  Shaped Reward berücksichtigt die im Experiment definierten Zielgrössen und
  wird der letzten Entscheidung des jeweiligen Zuges zugeordnet.
4. **Rollout-Aufbereitung:** Am Episodenende berechnet der Learner aus Reward,
  Value und Folgezustand die Generalized-Advantage-Schätzung (GAE) sowie den
  Return. Erst danach werden die `RolloutStep`-Einträge in den PPO-Rollout-
  Buffer übernommen.
5. **PPO-Update:** Sobald mindestens 2048 On-Policy-Entscheidungen gesammelt
  sind, trainiert PPO in Mini-Batches mit vier Epochen. Der Update kombiniert
  den geclippten Policy-Loss, den Value-Loss und einen Entropie-Term. Die
  Advantage-Werte werden standardmässig normalisiert.
6. **Zusatzsignale:** Vorhersagen anderer Policies, Counterfactual-Fork-
  Ergebnisse und menschliche Overrides werden separat gespeichert. Ein
  deutlich besserer Gegenfakt oder eine entsprechend bewertete menschliche
  Aktion kann einen Distillation-Sample erzeugen. Diese Daten werden nicht
  stillschweigend zu beobachtetem PPO-Reward umdeklariert.
7. **Sicherheitsprüfung und Veröffentlichung:** Die Kandidatenversion wird auf
  festen Evaluationsszenarien gegen die stabile Version und die Baseline
  geprüft. Bei ausreichender Sicherheit und Verbesserung wird sie als
  `online-ppo.pt` publiziert und im Hub unter `lab:online-ppo` angeboten.

Die spätere Agenteninspektion verwendet diesen veröffentlichten Checkpoint als
Evaluator in einer eigenen gemeinsamen Fork-Simulation. Diese Evaluation zeigt
PPO-Werte und Gegenfakten an, fügt die angezeigten, nicht ausgeführten Optionen
aber nicht automatisch dem On-Policy-Reward des Trainings hinzu.

#### Value-, Advantage- und Return-Berechnung

Der Value-Head des Actor-Critic-Modells schätzt für jede eigene PPO-Beobachtung
den Zustandswert $V_\theta(s_t)$. Nach der Ausführung und dem Eintreffen des
Rewards wird zunächst der TD-Fehler berechnet:

$$
\delta_t = r_t + \gamma (1-d_t) V_\theta(s_{t+1}) - V_\theta(s_t)
$$

Dabei ist $d_t=1$, wenn der Zug beziehungsweise die Episode beendet ist. Aus
den TD-Fehlern berechnet der Learner rückwärts den GAE-Vorteil:

$$
A_t = \delta_t + \gamma \lambda (1-d_t) A_{t+1}
$$

Der Trainings-Return für den Value-Head ist:

$$
R_t = A_t + V_\theta(s_t)
$$

Im PPO-Update wird der neue Critic gegen diesen Return trainiert:

$$
L_{value} = \operatorname{MSE}\left(V_\theta(s_t), R_t\right)
$$

Für die Matrix wird zusätzlich an einem Entscheidungspunkt eine begrenzte
Aktionsbewertung berechnet. Für jede zulässige Aktion $a$ wird eine Umgebungskopie
einen Schritt ausgeführt und der Wert geschätzt:

$$
Q_{1\text{-step}}(s_t,a) = r_t(a) + \gamma (1-d_t(a))V_\theta(s_{t+1}^{(a)})
$$

Diese Aktionswerte dienen der sichtbaren Rangfolge und Override-Unterstützung.
Sie ersetzen weder den langfristigen PPO-Return noch den beobachteten Reward
einer tatsächlich ausgeführten menschlichen Aktion.

### Stufe 1: Experiment stabilisieren

- mehrere Policies zuverlässig abfragen;
- gültige und nicht vorgeschlagene Kandidaten in begrenzten Forks testen;
- Ergebnisse und Unsicherheit strukturiert speichern;
- stabile Policy, Baseline, Evaluation und Rollback beibehalten;
- keine Live-Session-Aktion ungeprüft als PPO-On-Policy-Daten verwenden.

### Stufe 2: Anwenderbewertung sichtbar machen

- simulierte Bewertung der aktuellen menschlichen Aktion anzeigen;
- tatsächliches Ergebnis nach Ausführung nachführen;
- Unterschiede zwischen Prognose und Ergebnis darstellen;
- Policy-Ausfälle und fehlende Vorschläge sichtbar behandeln;
- Bewertungsbegriffe für Anwender verständlich benennen.

### Stufe 3: Historischen Vergleich aufbauen

- Planungsarchiv mit Zuständen, Aktionen, Kontext und Ergebnisqualität aufbauen;
- Ähnlichkeitssuche mit erklärbaren Filterkriterien implementieren;
- Erfolgskriterien und Vergleichsfenster konfigurierbar machen;
- Abweichungen zwischen aktueller Entscheidung und Referenzfällen erklären;
- keinen Vergleich anzeigen, wenn die Datenbasis zu klein oder nicht vergleichbar ist.

### Stufe 4: Reflexion und Lernen

- neutrale Rückfragen aus Abweichungen erzeugen;
- Anwenderantworten als Kontext und Feedback erfassen;
- Antworten nicht automatisch als Reward verwenden;
- geprüfte Signale getrennt von Rohfeedback in Lernpipelines überführen;
- Auswirkungen auf Policy-Versionen nachvollziehbar auditieren.

### Stufe 5: Kontrollierter Betriebsübergang

- Schattenbetrieb gegen menschliche und bestehende technische Entscheidungen durchführen;
- Freigabegrenzen, Abbruchkriterien und Eskalationswege mit dem Fachbereich testen;
- Policy-Drift, Datenqualitätsfehler, Ausfälle und Laufzeitüberschreitungen überwachen;
- Director-Aktionen zunächst nur simulieren oder vorschlagen;
- autonome Ausführung erst nach separater Sicherheits-, Human-Factors- und Betriebsfreigabe aktivieren.

---

## 9. Nicht-Ziele
## 9. Interpretation: Was aus dem Experiment gelernt werden kann

Das Experiment soll nicht beweisen, dass PPO für jede Situation die richtige
Aktion kennt. Es untersucht, ob eine gelernte Wertschätzung zusammen mit
kontrollierten Gegenfaktual-Simulationen dabei helfen kann, schwierige
Entscheidungen nachvollziehbarer zu reflektieren. Gerade bei einer lokalen
Weichenentscheidung entsteht die Wirkung oft erst durch das spätere
Zusammenspiel mehrerer Züge, belegter Gleise, Wartezeiten und Folgeaktionen.
Ein einzelner unmittelbarer Reward bildet diese Wirkung nur unvollständig ab.

### PPO als Reflexionshilfe, nicht als Urteil

Im Agent Inspector schätzt der angezeigte Ein-Schritt-Q-Wert für jede zulässige
Aktion den unmittelbaren Reward plus den diskontierten Critic-Wert des
Folgezustands: $Q(s,a) \approx r + \gamma V(s')$. Der Advantage vergleicht diese
Schätzung mit dem Wert des aktuellen Zustands: $A(s,a)=Q(s,a)-V(s)$. Damit kann
PPO sichtbar machen, welche Aktion aus Sicht des gelernten Modells eher besser
oder schlechter als die aktuelle Ausgangslage erscheint. Ein positiver
Advantage ist eine günstige Tendenz gemäss dem trainierten Reward, kein
Nachweis, dass die Aktion objektiv gut ist. Ein negativer Advantage ist ein
Anlass zum Prüfen, kein Beweis, dass die Aktion falsch ist.

Die Ein-Schritt-Schätzung ist bewusst von den längeren Forks zu unterscheiden.
Ein Fork führt die jeweilige Kandidatenaktion in einer Umgebungskopie aus und
lässt anschliessend die greedy Online-PPO-Policy bis zu 20 Schritte
weiterfahren. So lässt sich eine lokale Wahl unter einer festgelegten
Fortsetzungsstrategie mit Alternativen vergleichen. Auch dieser Vergleich ist
eine bedingte Simulation und keine sichere Vorhersage des realen Verlaufs.

### Deadlock: intern geprüft, noch nicht pro Aktion sichtbar

Die Fork-Bewertung zählt die deadlocked agents vor und nach der Simulation.
Entsteht bis zum Ende des Fork-Horizonts mindestens ein zusätzlicher
Deadlock-Agent, wird der Kandidat als nicht machbar markiert. Ein solcher Fork
kann nicht als bestes Distillation-Ziel ausgewählt werden. Auch die spätere
Policy-Version wird gegen die stabile Version und die Baseline auf
Deadlock-Sicherheit geprüft.

Das beantwortet die Frage „führt genau diese Aktion in einen Deadlock?“ in der
aktuellen Oberfläche aber noch nicht direkt. Der Agent Inspector zeigt Q- und
Advantage-Schätzungen, keine Deadlock-Ampel pro Aktion. Der Learning Monitor
zeigt Buffer-Bestände, Score und Ankunftsrate, aber keine einzelnen
Fork-Ergebnisse. Die Deadlock-Information wird in der Lern- und
Fork-Bewertung verarbeitet, ist für Anwenderinnen und Anwender jedoch noch
nicht als konkrete Folge einer einzelnen Aktion aufgeschlüsselt.

Auch die Messregel ist begrenzt: Am Ende des Horizonts zählt sie aktive Züge,
die auf der Karte direkt vor einem von einem anderen Zug belegten Feld stehen.
Die Machbarkeitsprüfung vergleicht die Zahl mit dem Ausgangszustand. Sie
verwirft also zusätzliche Deadlocks, beweist aber weder, dass der Ausgang
deadlockfrei ist, noch dass jenseits des 20-Schritte-Horizonts kein Deadlock
entsteht. Diese operationalisierte Zählung ist ein Sicherheitssignal, keine
vollständige Garantie gegen jede Form von Blockierung.

### Gute und schlechte Tendenzen belastbar bestimmen

Eine einzelne Q-Schätzung, ein einzelner Advantage oder ein einzelner Fork
reicht nicht, um eine allgemeine gute oder schlechte Aktion festzustellen.
Sinnvoll ist eine Tendenzaussage erst über wiederholte, vergleichbare
Entscheidungssituationen: gleiche Szenarioklasse und Ausgangslage, dokumentierte
Seeds, identische Fortsetzungsregel sowie Vergleich mit stabiler Policy und
Baseline. Ausgewiesen werden sollten mindestens Fallzahl, Streuung und Anteil
der Fälle mit zusätzlichem Deadlock; bei ausreichender Datenmenge kann zudem
geprüft werden, wie oft die Rangfolge der PPO-Advantages mit den längeren
Fork-Ergebnissen übereinstimmt.

So kann das Experiment untersuchen, ob PPO wiederkehrende Muster erkennt, etwa
dass eine frühe Warteaktion in einer bestimmten Konfliktlage häufiger zu
weniger Blockierungen führt. Daraus folgt keine universelle Handlungsregel:
Eine andere Zugkonstellation, ein anderer Zeithorizont oder eine andere
Fortsetzungs-Policy kann die Tendenz verändern. Die Anzeige soll deshalb
Zustand, Vergleichsgrundlage und Unsicherheit mitliefern und nicht nur „gut“
oder „schlecht“ ausgeben.

### Interpretationsrisiken

- **Zielabhängigkeit:** PPO-Reward und Fork-Score beantworten unterschiedliche
  Fragen. Eine Rangfolge gilt nur relativ zu den implementierten Zielen und
  Gewichten; sie ist kein fachliches Gesamturteil.
- **Begrenzter Horizont:** Eine Aktion kann innerhalb von 20 Schritten machbar
  wirken und später dennoch zu einer Blockierung führen. Umgekehrt kann eine
  kurzfristig ungünstige Warteaktion langfristig sinnvoll sein.
- **Fortsetzungsabhängigkeit:** Im Fork folgt auf den Kandidaten die greedy
  Online-PPO-Policy. Der gemessene Ausgang beschreibt daher die Kombination
  aus Kandidatenaktion und dieser Fortsetzungsstrategie, nicht die isolierte
  Wirkung der ersten Aktion unter jeder denkbaren Folge.
- **Manuelle Override-Wertung:** Der aktuelle Fork-Score enthält für manuell
  eingebrachte Kandidaten einen negativen Term (`manual`, Gewicht `-0.05`).
  Ein Vergleich mit PPO-Aktionen kann dadurch teilweise die Herkunft der Aktion
  statt nur ihre simulierte Wirkung widerspiegeln. Vor einer Interpretation
  menschlicher Aktionen muss geklärt werden, ob dieser Term eine beabsichtigte
  Betriebskostenannahme oder eine zu überprüfende Verzerrung darstellt.
- **Keine Human-Factors-Evidenz:** Technisch bessere Scores zeigen nicht, dass
  Menschen die Anzeige besser verstehen, weniger belastet sind oder bessere
  Entscheidungen treffen. Das muss separat mit Anwenderinnen und Anwendern
  untersucht werden.

Der belastbare Erkenntnisgewinn des aktuellen Prototyps liegt damit zunächst
im technischen Vergleich: Er kann eigene PPO-Rollouts, Policy-Vorschläge,
Fork-Ergebnisse und ausgewählte Distillation-Ziele getrennt verarbeiten und
Versionen auf festgelegten Szenarien vergleichen. Ob die Schätzungen
hinreichend kalibriert sind und die Reflexion tatsächlich verbessern, bleibt
eine empirische Frage für kontrollierte Folgeversuche.

## 10. Ausblick: Vom Wertsignal zur überprüfbaren Reflexion

1. **Einzelne Folgen sichtbar machen:** Den Inspector um das Ergebnis des
  passenden Forks ergänzen: simulierte Score-Komponenten, Ankünfte, Wartezeit,
  Veränderung der Deadlock-Zahl, Machbarkeit und verwendeter Horizont. Die
  Anzeige muss klar als bedingte Prognose gekennzeichnet sein. Wo kein Fork
  vorliegt oder er nicht auswertbar ist, darf kein Ergebnis aus dem
  Ein-Schritt-Q abgeleitet werden.
2. **PPO-Schätzung gegen Fork-Ausgang prüfen:** Für dieselben
  Entscheidungspunkte Q-/Advantage-Rangfolge und längere Fork-Ausgänge
  systematisch vergleichen. Dafür sind feste Szenarien, wiederholte Seeds,
  dokumentierte Baselines und getrennte Auswertungsdaten nötig. Neben dem
  Mittelwert gehören Streuung, Fallzahl und Deadlock-Häufigkeit in den
  Bericht.
3. **Tendenzen statt Einzelfallurteile berichten:** Ergebnisse nach
  vergleichbaren Entscheidungskontexten gruppieren. Eine Regel wie „Aktion A
  ist häufig besser“ nur dann formulieren, wenn sie über mehrere Seeds und
  Szenarien stabil bleibt und die Unsicherheit ausgewiesen ist.
4. **Zielgewichte und Override-Term überprüfen:** Die Gewichtung von
  Pünktlichkeit, Ankünften, Verspätung, Warten und manuellen Overrides
  gemeinsam mit Fachanwendern festlegen. Eine Sensitivitätsanalyse soll zeigen,
  ob sich Rangfolge oder Distillation-Ziele bei plausiblen Gewichtsänderungen
  umkehren.
5. **Reflexionsnutzen mit Menschen testen:** In einem begrenzten
  Human-Factors-Pilot prüfen, ob die getrennte Darstellung von PPO-Tendenz,
  Fork-Prognose und beobachtetem Ergebnis das Verständnis verbessert. Dabei
  auch Automationsbias, mentale Belastung und die Möglichkeit zum begründeten
  Widerspruch messen; Klicks auf „Akzeptieren“ allein sind kein Erfolgsmaß.
6. **Prognosen mit späteren Beobachtungen vergleichen:** Falls tatsächliche
  Ergebnisse verfügbar und freigegeben sind, Simulation und Beobachtung
  versioniert gegenüberstellen. Erst nach einer solchen Kalibrierung ist zu
  entscheiden, ob weitere Prognosen oder menschliche Rückmeldungen in neue
  Lernpfade aufgenommen werden dürfen.

Bis diese Prüfungen abgeschlossen sind, ist PPO am sinnvollsten als
Reflexionssignal zu verwenden: Es kann auf mögliche Unterschiede und Risiken
hinweisen, ersetzt aber weder eine belastbare Gegenfaktual-Auswertung noch die
fachliche Entscheidung.

## 11. Nicht-Ziele

Die erste Ausbaustufe soll nicht:

- eine Produktionsfreigabe durch Simulation ersetzen;
- jede menschliche Aktion automatisch als Trainingsbeispiel verwenden;
- eine historische Statistik als objektive Wahrheit darstellen;
- den Anwender durch eine einzelne Policy-Konfidenz überstimmen;
- aus einer kleinen Zahl von Demonstratorläufen allgemeine Leistungsversprechen ableiten;
- eine autonome Director-Funktion ohne klare Grenzen und Eingriffsmöglichkeit aktivieren.

Folgende Aussagen sind ausdrücklich unzulässig:

- «Die AI weiss, was richtig ist», wenn nur ein Modellscore oder eine Simulation vorliegt;
- «Die letzten 50 Fälle beweisen die beste Strategie», wenn Vergleichbarkeit und Erfolgskriterium nicht dokumentiert sind;
- «Die AI hat aus dem Betrieb gelernt», wenn die Daten nicht geprüft, freigegeben und in der passenden Lernmethode verarbeitet wurden;
- «Die Empfehlung ist sicher», wenn lediglich eine Policy-Übereinstimmung oder ein hoher Konfidenzscore vorliegt.

---

## 12. Offene Entscheidungen vor dem Pilot

Vor der Implementierung des nächsten Slices müssen Fachbereich und Technik mindestens folgende Punkte schriftlich entscheiden:

1. Welche konkrete Planungsaktion und welcher Entscheidungspunkt werden zuerst unterstützt?
2. Welche Ziele, Sicherheitsgrenzen und Mindestkriterien definieren eine akzeptable Aktion?
3. Welche Zustände und Aktionen dürfen archiviert werden, und welche Daten dürfen für Training verwendet werden?
4. Wie werden ähnliche Fälle bestimmt, und ab welcher Fallzahl wird ein Vergleich angezeigt?
5. Wie lange darf eine Fork-Simulation dauern, bevor sie als nicht verfügbar gilt?
6. Wie werden zufällige Störungen, fehlende Zustände und widersprüchliche Policy-Ergebnisse dargestellt?
7. Welche Metriken, Baselines, Testfälle und Freigabeschwellen gelten für jede Policy-Version?
8. Welche Rolle darf in welchem Modus autonom handeln, und wer darf den Modus ändern?
9. Welche Audit-, Datenschutz-, Aufbewahrungs- und Löschregeln gelten für Anwenderaktionen und Begründungen?
10. Welche Human-Factors-Instrumente messen Belastung, Vertrauen, Automationsbias und tatsächlichen Lernnutzen?

Keine dieser Fragen darf durch einen Defaultwert verdeckt werden, wenn sie die fachliche Sicherheit oder die Interpretation eines Ergebnisses verändert.

---

## 13. Akzeptanzkriterien für die Umsetzung

Die Ausbaustufe ist fachlich akzeptabel, wenn:

1. mindestens drei unterschiedliche Policy-Perspektiven dieselbe Situation bewerten können;
2. der Anwender Vorschläge vergleichen und eine eigene Aktion ausführen kann;
3. simulierte Wirkung, beobachtete Wirkung und historische Vergleichswerte getrennt angezeigt werden;
4. jede Bewertung ihre Datenbasis und Unsicherheit kenntlich macht;
5. nicht ausgeführte Aktionen keinen beobachteten Reward erhalten;
6. PPO-On-Policy-Daten von anderen Vorschlägen und Anwenderfeedback getrennt bleiben;
7. historische Vergleichsfälle nach Kontext und Erfolg ausgewählt werden;
8. eine menschliche Erklärung gespeichert werden kann, ohne automatisch als Wahrheit oder Reward zu gelten;
9. neue Policy-Versionen gegen stabile Version und Baseline geprüft werden;
10. Sicherheitsverletzungen, Policy-Ausfälle und Rollbacks nachvollziehbar protokolliert werden;
11. der Anwender in Empfehlung und Co-Learning die Kontrolle behält;
12. Director-Autonomie nur innerhalb expliziter Grenzen aktiviert werden kann.
13. jede Funktion in Dokumentation und Oberfläche als Experiment, v0, Pilot-Ausbau oder Zielbild einordenbar ist;
14. eine fehlende Datenbasis zu «nicht bewertet» führt und nicht zu einer erfundenen Rangfolge;
15. Prognose, Beobachtung und historischer Vergleich mit Herkunft, Version und Zeit getrennt gespeichert werden;
16. Offline-, Online-, Sicherheits- und Human-Factors-Metriken separat ausgewiesen werden;
17. Policy-Drift, OOD-Zustände und Laufzeitüberschreitungen eine definierte Fallback-Reaktion auslösen;
18. Management eine Go-/No-Go-Entscheidung anhand dokumentierter Metriken und Risiken treffen kann;
19. Data Scientists Datenleckage, Reward-Verzerrung und Quellenvermischung prüfen können;
20. Architekten Versionierung, Auditierbarkeit, Zugriffskontrolle und Rollback nachweisen können;
21. Anwender eine Empfehlung ablehnen, eine eigene Aktion ausführen und eine nicht passende Begründung erfassen können;
22. Human-Factors-Tests zeigen, dass die neue Funktion nicht lediglich Automationsbias oder Leistungsdruck erhöht.

---

## 14. Wiederverwendbarer Umsetzungs-Prompt

> Entwickle die nächste Ausbaustufe des LAB-Online-PPO-Systems als Human-AI-Teaming-Partner für komplexe, wiederkehrende Planungsentscheidungen.
>
> > Nutze die bestehende Flatland- und OnlineLearner-Architektur. Unterstütze mehrere Policy-Perspektiven und vergleiche ihre gültigen Handlungsvorschläge in begrenzten Fork-Simulationen. Zeige dem Anwender Optionen, erwartete Wirkungen, Zielkonflikte und Unsicherheit. Ermögliche jederzeit eine menschliche Entscheidung oder Übersteuerung.
> >
> > Trenne strikt zwischen PPO-On-Policy-Rollouts, Vorschlägen anderer Policies, simulierten Gegenfakten, beobachteten Ergebnissen, historischen Vergleichsfällen und menschlichem Feedback. Verwende keine nicht ausgeführte Aktion als beobachteten Reward. Vermische PPO-Reward, Critic/Value und Simulationsscore nicht.
> >
> > Ergänze als konfigurierbaren Ausbau ein Planungsarchiv mit kontextbewusster Ähnlichkeitssuche. Vergleiche eine aktuelle Entscheidung nur mit ausreichend ähnlichen und erfolgreich bewerteten Fällen. Wenn die Datenbasis nicht ausreicht, zeige keinen scheinpräzisen Vergleich an.
> >
> > Formuliere Rückfragen neutral und reflexionsorientiert. Speichere Antworten als Kontext und Feedback, aber behandle sie nicht automatisch als Reward, Wahrheit oder Fehlerlabel. Halte menschliche Kontrolle, Unsicherheitsanzeige, Audit-Log, Evaluation gegen stabile Version und Baseline sowie Rollback als Sicherheitsanforderungen ein.
> >
> > Implementiere zuerst einen vertikalen, testbaren Slice: eine konkrete Planungsaktion, mehrere Policy-Vorschläge, eine Fork-Bewertung, eine menschliche Übersteuerung, ein beobachtetes Ergebnis und eine verständliche Anzeige. Begrenze Forks auf relevante Entscheidungspunkte und einen definierten Horizont.
> >
> > Ergänze danach Historienvergleich, Reflexionsdialog und weitere Lernsignale. Weise für jede Funktion aus, ob sie experimentell belegt, im v0 vorhanden, ein Pilot-Ausbau oder ein Zielbild ist. Kennzeichne ausdrücklich, was nicht automatisch aus Live-Sessions abgeleitet werden darf.
> >
> > Lege vor dem Coding den Datenvertrag, die Metriken, die Baselines, die Unsicherheits- und Fallback-Logik, den Auditbedarf sowie die Zuständigkeit von Management, Data Science, Architektur, Fachanwendern und Human Factors fest. Schreibe zuerst Tests für Datenquellentrennung, fehlende Vergleichsdaten, Policy-Ausfall, Rollback, Override und die Unterscheidung von Prognose und beobachtetem Ergebnis.
> >
> > Behandle einen erfolgreichen LAB-Lauf nicht als Produktionsnachweis. Validiere zunächst in einem begrenzten Schattenbetrieb gegen menschliche und bestehende technische Baselines. Eine autonome Aktion darf erst nach separater Sicherheits-, Betriebs- und Human-Factors-Freigabe aktiviert werden.
