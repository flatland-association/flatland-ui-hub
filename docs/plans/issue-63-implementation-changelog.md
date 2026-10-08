# Issue #63 – Umsetzung und Änderungsprotokoll

## Zweck und Entscheidungsstand

Issue #63 bereinigt die uneinheitliche Verwendung von Begriffen rund um
Bahnnetz, Zugverkehr, Störungen, Versuchskonfigurationen, Strategien und die HMI. Das Ziel
ist ein eindeutiges Vokabular, bei dem jeder fachliche Begriff genau eine
Bedeutung besitzt. Die Umsetzung darf das Verhalten der Anwendung nicht
verändern.

Die Arbeit wird als kontrollierter Frühphasen-Cutover durchgeführt. Das
Projekt ist noch vor Version 1.0 und hat laut Issue keine externen API-Nutzer.
Deshalb sind harte Umbenennungen erlaubt. Es werden jedoch keine Aliase,
Kompatibilitäts-Endpoints, Übergangswrapper, parallelen Konfigurationspfade
oder Feature Flags eingeführt.

Dieses Dokument ist die Prosa-Dokumentation, das Umsetzungsprotokoll und der
Änderungslog für Issue #63. Die technische Umsetzung erfolgt in drei logisch
getrennten Pull Requests: PR A für Vokabular und sichtbare UI-Texte, PR B für
die Frontend-Identifier und PR C für Backend, Fixtures und Dokumentdateien.
Nach jedem PR gibt es einen Review- und Validierungsstopp.

## Fachliche Abgrenzung

Die Welt-Ebene besteht aus dem Bahnnetz, dem Betriebsprogramm und dem
Störungsszenario. Das Bahnnetz beschreibt die physische Topologie. Das
Betriebsprogramm beschreibt die Zugläufe, ihre Beziehungen, Abfahrten und
Halte. Ein Störungsszenario beschreibt, was im Betrieb schiefgeht, wann es
passiert und welche Züge oder Infrastrukturelemente betroffen sind.

Die Run-Ebene besteht aus der Versuchskonfiguration, dem Referenzlauf und dem
Simulationslauf. Eine Versuchskonfiguration ist die konkrete Zusammensetzung, die gestartet
wird. Der Referenzlauf bezeichnet die Ausgangsplanung. Der Simulationslauf
bezeichnet die tatsächliche Ausführung.

Auf Sitzungsebene liegen Layout, Modus und Sitzung. Der Modus ist einer der
bestehenden Werte `recommendation`, `co-learning` oder `director`. Die
Führungs-Ebene besteht aus Tour und Experiment.

Technische Begriffe und sichtbare Begriffe werden bewusst getrennt. Ein
`Policy`-Objekt bleibt im Runtime-Code eine technische Entscheidungslogik. In
der Benutzeroberfläche wird es als Entscheidungsverfahren oder als Teil des
Strategienvergleichs dargestellt. Ein `WidgetMeta`-Eintrag beschreibt ein
Widget; eine gemeinsame `BaseWidget`-Klasse wird nicht eingeführt.

### Vollständige Terminologie-Tabelle

| Fachkonzept | Flatland-Begriff | AI4REALNET Use Case 2 | Deutscher Zielbegriff | Zuständig im `flatland-ui-hub`-Code | Kommentar / fachlicher Kontext |
|---|---|---|---|---|---|
| Physische Eisenbahntopologie | `RailEnv` und Infrastrukturgraph | Railway network | Bahnnetz | `InfrastructureScene` wird später zu `RailNetwork`; Infrastruktur-Feature wird zum Netz-Editor | Beschreibt Gleise, Weichen, Stationen und Verbindungen, nicht den laufenden Verkehr. |
| Laufende Zugobjekte | `env.agents`, Agent-Handles | Trains / train agents | Zuglauf | `AgentDTO`, `AgentStop` und `scene.agents` bleiben unverändert | Flatland-nahe Namen gehören zur Integrationsgrenze und werden in Issue #63 nicht umbenannt. |
| Zuglauf und Haltefolge | Agent schedule / route data | Train service / timetable | Betriebsprogramm | `timetable`, Zug- und Roster-Modelle | Beschreibt die geplante Bewegung und die Halte eines Zuges. |
| Technischer Fehler | `malfunction`, `malfunction_rate` | Technical failure | Technischer Fehler | Flatland-Felder bleiben unverändert; sichtbare Texte verwenden nicht `malfunction` | Ein technischer Fehler ist ein technisches Ereignis, nicht automatisch eine betriebliche Störung. |
| Betriebliche Störung | Disturbance input / event | Operational disruption | Betriebsstörung | `ScenarioDisturbance` wird zu `DisruptionEvent`; `disturbances.py` wird zu `disruptions.py` | Beschreibt die fachliche Wirkung auf den Betrieb und kann technische Fehler, Sperrungen oder Verspätungen umfassen. |
| Abweichung vom Plan | Observation / delay difference | Deviation from plan | Abweichung | Abweichungs- und Prognosemodelle | Ist- und Soll-Zustand werden verglichen; eine Abweichung ist noch keine Ursache. |
| Reaktion auf eine Störung | Replanning / rescheduling | Response / re-scheduling | Neuplanung | Planungs- und Replan-APIs | Neuplanung ist die Reaktion auf eine Lage, nicht die Lage selbst. |
| Qualifizierter Konsortiumsbegriff | Nicht Flatland-eigen | `operational_scenario`, `UC1.R-*` | Betriebsszenario (D4.1) | D4.1-Referenzen und Katalogdokumentation | Der Zusatz `(D4.1)` bleibt immer erhalten; der Begriff wird nicht als allgemeines Szenario verwendet. |
| Konkrete Startzusammensetzung | Environment configuration | Experimental setup | Versuchskonfiguration | `ScenarioPreset` wird in PR C zu `SetupPreset`; `/setups` | Die Versuchskonfiguration verbindet Bahnnetz, Betriebsprogramm, Störungsdaten und Startparameter. |
| Ausgangsvergleich | Initial / baseline run | Reference run | Referenzlauf | Session- und Forecast-Zustand | Dient als Vergleichspunkt für eine Simulation. |
| Tatsächliche Ausführung | Environment step / rollout | Simulation run | Simulationslauf | Session- und Run-State | Bezeichnet die ausgeführte Folge von Simulationsschritten. |
| Entscheidungslogik | Policy | Decision policy | Entscheidungsverfahren | `PolicyName`, `PolicyInfo`, `policies/` | `Policy` bleibt als technischer Identifier erhalten; die UI nutzt den verständlicheren Zielbegriff. |
| Vergleichbare Handlungsoption | Action / policy choice | Strategy alternative | Strategie | `ScenarioOption` wird zu `ActionOption`; Strategienvergleich | Strategie ist hier eine auswählbare fachliche Option, nicht zwingend eine neue Policy-Klasse. |
| Neutraler Katalog von Verfahren | Policy registry | Strategy catalogue | Strategie-Katalog | `AlgorithmsGalleryComponent` wird zu `StrategyCatalogComponent`; `/strategies` | Der frühere Begriff Algorithmus wird in der sichtbaren Anwendung ersetzt. |
| Konkrete Empfehlung | Recommendation | AI recommendation | Empfehlung | Recommendations- und proposal-Modelle | Die Empfehlung ist eine gerahmte Entscheidungshilfe; die menschliche Entscheidung bleibt modeabhängig. |
| Wiederverwendbare HMI-Einheit | Widget | HMI widget | Widget | `WidgetMeta`, `WIDGET_CATALOG`, Widget-Registrierung | Es wird keine neue gemeinsame Widget-Basisklasse erfunden. |
| Widget-Auswahl | Widget gallery | Widget catalogue | Widget-Katalog | `WidgetsGalleryComponent` wird zu `WidgetCatalogComponent` | Katalog statt Gallery ist die fachliche UI-Bezeichnung. |
| Versuchskonfigurations-Auswahl | Scenario gallery | Experimental setup catalogue | Katalog der Versuchskonfigurationen | `ScenarioGalleryComponent` wird zu `SetupCatalogComponent`; `/setups` | Der alte Name „Scenario Gallery“ wird nicht weitergeführt. |
| Vergleich von Optionen | Scenario panel | Strategy comparison | Strategienvergleich | `ScenarioPanelComponent` wird zu `StrategyComparisonPanelComponent`; Panel-Key `strategy-comparison` | Der Panel-Key `scenario` wird ohne Alias migriert. |
| Bearbeitung des Bahnnetzes | Infrastructure builder | Network editor | Netz-Editor | `features/infrastructure-builder/` wird zu `features/network-editor/`; `InfrastructureScene` wird zu `RailNetwork` | Der Editor bearbeitet Netzstruktur, nicht allgemeine Szenarien. |
| Bearbeitung der Anordnung | Layout designer | Layout editor | Layout-Editor | Layout-Designer und gespeicherte Layouts | Layout beschreibt die Anordnung der Widgets, nicht die Infrastruktur. |
| Einstieg in die Sitzung | Start screen / scenario selection | Experimental setup selection | Startdialog | Start-Screen bleibt im bestehenden Issue ausserhalb eines Redesigns | Nur Begriffe werden vorbereitet; ein Startdialog-Umbau ist Folgearbeit. |
| Sitzung | Session | Human-AI session | Sitzung | `SessionState`, `SessionInfo`, `SessionStore` | Eine Sitzung enthält Modus, Versuchskonfiguration, Layout und laufenden Zustand. |
| Zusammenarbeit zwischen Mensch und KI | Interaction mode | Human-AI collaboration mode | Interaktionsmodus | `InteractionMode` und `SessionStore.interactionMode` | Die drei bestehenden Modi bleiben semantisch unverändert. |
| Geführter Lernablauf | Tour | Guided learning | Tour | Tour- und Reflection-Features | Tour ist ein Ablauf, kein allgemeiner Betriebsfall. |
| Vergleichendes Vorhaben | Experiment | Experiment | Experiment | Experiment- und Sandbox-Modelle | Experiment bezeichnet den übergeordneten Untersuchungsrahmen. |

## Eigentumsgrenzen

Flatland-Begriffe bleiben an der Integrationsgrenze erhalten. Dazu gehören
insbesondere `RailEnv`, `env.agents`, `malfunction`, `malfunction_rate` und
Agent-Handles. Diese Namen werden nicht in neue UI-Texte übernommen.

Die Begriffe des D4.1-Katalogs, insbesondere `operational_scenario` und
`UC1.R-*`, gehören dem Konsortium und werden nicht umbenannt. Die deutsche
Bezeichnung lautet immer **Betriebsszenario (D4.1)**.

Der alleinstehende Begriff `Scenario` beziehungsweise `Szenario` ist in der
eigenen UI, Dokumentation und in neuen Identifikatoren verboten. Ein Begriff
muss qualifiziert werden: als Störungsszenario, Versuchskonfiguration oder Betriebsszenario
(D4.1). Im Code darf `scenario` nur an einer ausdrücklich dokumentierten
Flatland- oder D4.1-Grenze verbleiben.

## Umsetzung in Phasen

### Phase 0 – Vorbereitung und Baseline

Zuerst wird die Entscheidung im Issue festgehalten. Das Issue wird in die drei
Teilaufgaben PR A, PR B und PR C aufgeteilt. Folge-Issues für den
Network-/Traffic-Split, den Startdialog-Umbau und die Flatland-nahen
Zuglaufnamen halten bewusst ausgenommene Arbeiten fest.

Vor der ersten Änderung wird eine Baseline erstellt. Dazu gehören der aktuelle
Frontend-Build, die Frontend-Tests, die Backend-Tests und ein exportiertes
Layout aus dem Browser-Local-Storage. Diese Baseline belegt später, dass die
Umbenennung keinen Verhaltenswechsel verursacht.

Der Baseline-Stand vom 2026-10-07 war: `npm run i18n:check`,
`npm run lint:styles` und der Produktionsbuild wurden ausgeführt. Style-Lint
und Produktionsbuild waren erfolgreich; der Build meldet die bereits bekannte
Survey-Warnung `NG8102` sowie die bestehende Überschreitung des
Initial-Bundle-Budgets. Der Terminologie-Guard ist erfolgreich. Die
Backend-Suite war im zuerst verwendeten Python blockiert, weil
`pydantic_settings` fehlte; danach wurde sie in der projektkonformen Umgebung
ausgeführt.

Der Checkpoint ist erfüllt, wenn die Entscheidung dokumentiert, die drei
Teilaufgaben angelegt, die Tests grün und ein alter Layout-Export gesichert
sind.

### Phase 1 – Terminologie-Inventar

Alle Vorkommen der alten Begriffe werden als Rohinventar erfasst. Das Inventar
wird anschließend in UI-Texte, Übersetzungen, Dokumentation, Kommentare,
Identifikatoren, APIs, Routen, persistierte Daten und externe Begriffe
kategorisiert.

Besonders geprüft wird, ob die bisherigen Endpoints
`/session/scenario-presets` und `/scenario-policies` außerhalb dieses
Repositorys verwendet werden. Nur wenn kein externer Verbraucher existiert,
darf PR C diese Endpoints hart umbenennen.

Der Checkpoint ist erfüllt, wenn jede Fundstelle kategorisiert ist, alle
menschlichen Entscheidungen geklärt sind und die externe API-Nutzung bekannt
ist.

### PR A – Vokabular of Record

PR A enthält keine Umbenennung von Code-Identifikatoren. Es entstehen die
beiden Referenzdokumente `docs/reference/terminology.md` und
`docs/reference/terminology-inventory.md`.

Das Glossar enthält das englische Quellvokabular, die deutschen Zielbegriffe,
die Eigentumsgrenzen von Flatland und D4.1, die Verbotsliste, den Abschnitt zu
mehrdeutigen Begriffen und die Invariante, dass `scenario` im Code nicht die
sichtbare Bedeutung „Szenario“ besitzt.

Das Inventar enthält jede relevante Fundstelle mit Pfad, Zeile, bisherigem
Begriff, vorgeschlagenem Begriff und Kategorie. Nicht eindeutig entscheidbare
Fundstellen werden in einem eigenen Abschnitt gesammelt.

Danach werden nur sichtbare Werte geändert: Übersetzungen, Überschriften,
Buttons, Tooltips, Aria-Labels, Katalogtitel und hardcodierte UI-Texte. Die
englischen Werte werden zuerst angepasst; Deutsch und Französisch folgen als
Übersetzungen.

Die widersprüchliche Stelle in der bisherigen
[scenario-infrastructure-gallery.md](scenario-infrastructure-gallery.md) wird
korrigiert. Die Begründungsabschnitte bleiben inhaltlich erhalten. Die
bestehenden Versuchskonfigurationen erhalten einen sichtbaren Referenten für
`operational_scenario`, ohne dass der Begriff auf andere Konzepte ausgedehnt
wird.

### Phase 3 – Terminologie-Prüfung

Nach PR A wird `tools/check-terminology.sh` eingeführt. Der Guard prüft die
verbotenen UI-Begriffe, alleinstehendes `Scenario` beziehungsweise `Szenario`,
`Betriebsszenario` ohne den Zusatz `(D4.1)` sowie die abgeschafften Begriffe
Builder, Generator, Gallery, Fehlfunktion, Ansichtsanordnung und
Verfahrens-Katalog.

Der Guard wird als eigener npm-Befehl und als eigener CI-Schritt eingebunden,
damit Terminologiefehler sichtbar von anderen Lint-Fehlern unterschieden
werden können. Ein bewusster Testtreffer muss den Guard fehlschlagen lassen;
danach wird der Testtreffer wieder entfernt.

PR A endet mit einem Review-Stopp. PR B beginnt erst nach der Freigabe.

### PR B – Frontend-Umbenennungen

PR B führt die Frontend-Renames als getrennte, einzeln revertierbare Commits
durch. Zuerst wird der Panel-Key `scenario` zu `strategy-comparison`
umbenannt und gleichzeitig die Local-Storage-Migration eingebaut. Alte
Layouts werden beim Lesen einmalig migriert, die Storage-Schema-Version wird
erhöht und unbekannte Panel-Typen werden verworfen, ohne die Anwendung zum
Absturz zu bringen.

Danach werden der Panel-Typ, die drei Katalog-Komponenten, das
Infrastruktur-Feature, die betroffenen Modelle, die Routen und die
`show...`-Zustände umbenannt. Die bestehenden `window.location`-Wechsel bleiben
erhalten; ein Angular-Router wird nicht eingeführt.

Nach jedem Rename werden die direkten Aufrufer, Tests, Templates und
Registrierungsstellen aktualisiert. Am Ende darf nur die dokumentierte
Migrationskarte noch den alten Panel-Key enthalten.

PR B endet mit einem Review-Stopp. PR C beginnt erst nach der Freigabe.

### PR C – Backend und Dokumentdateien

PR C benennt die Backend-Grenzen als zusammenhängende harte Umbenennung um.
Dazu gehören die Presets der Versuchskonfigurationen, die Disruption-Events, `setup_id`, `network_id`,
die neuen Endpoints und die Strategie-Forecasts. Es werden keine alten
Endpoints weiterbetrieben.

Die Fixture-Dateien und ihre JSON-Schlüssel werden im selben Schritt angepasst.
Für jedes Fixture wird ein Ladetest ergänzt. Die drei betroffenen
Dokumentdateien werden mit `git mv` verschoben und alle eingehenden Links
aktualisiert.

Die Frontend-Aufrufer wurden im selben PR angepasst, damit kein Zwischenstand
mit einem inkompatiblen Backend entsteht. Die Validierung umfasst Backend-
Tests, Frontend-Build, den Terminologie-Guard und einen vollständigen Lauf vom
Laden der Versuchskonfiguration über eine aktivierte Betriebsstörung bis zu mehreren
Simulationsschritten. Die Fokustests bestanden mit `23 passed`. Der
vollständige Backend-Lauf ergab `533 passed` und zwei verbleibende, nicht
terminologiebezogene Fehler: den Director-Parallelvergleich und den
Root-Smoke-Test.

### Phase 6 – Abschluss

Nach PR C wird das Inventar erneut gezählt. Die Vorher-/Nachher-Zählung wird im
Issue-Abschlusskommentar dokumentiert. Verbleibende Treffer werden einzeln mit
der Flatland- oder D4.1-Grenze begründet.

Das Glossar wird in `CONTRIBUTING.md` verlinkt. Die Terminologie-Prüfung wird in
der PR-Checkliste erwähnt. Verschobene Arbeiten werden auf die Folge-Issues
verwiesen.

## Validierung und Checkpoints

Die maßgeblichen Frontend-Befehle lauten:

```bash
cd frontend
npm run i18n:check
npm run lint:styles
npx ng build --configuration production
npm test -- --watch=false --browsers=ChromeHeadless
```

Die maßgeblichen Backend-Befehle lauten:

```bash
cd backend
pytest -q
```

Der Terminologie-Guard wird zusätzlich direkt und über den CI-Eintrag
aufgerufen. Für die Migration wird ein alter Layout-Export geladen und
anschließend geprüft, dass der neue Panel-Key gespeichert wird, kein alter
Alias verbleibt und ein unbekannter Panel-Typ sicher verworfen wird.

Die Tests müssen jeweils in der projektkonformen Umgebung laufen. Ein Fehler
wegen fehlender Installation gilt als Umgebungsfehler und nicht als
Terminologie-Regression; er wird im Protokoll mit der fehlenden Abhängigkeit
vermerkt.

## Bewusst außerhalb des Umfangs

Der Network-/Traffic-Split wird nicht im Rahmen von Issue #63 umgesetzt. Ebenso
bleiben der Startdialog-Umbau, `AgentDTO`, `AgentStop` und `scene.agents` als
Flatland-nahe Namen außerhalb dieses Issues. Neue Katalog-Metadaten und
Verhaltensänderungen sind ebenfalls nicht Teil der Umbenennung.

Es werden keine Kompatibilitäts-Shims, keine Alias-Exports, keine parallelen
Konfigurationspfade und keine zusätzlichen Router eingeführt. Die bestehende
Verhaltenslogik, Modussemantik, Persistenzlogik außerhalb der ausdrücklich
benötigten Layout-Migration und die Simulationsausführung bleiben unverändert.

## Änderungsprotokoll

**2026-10-06 – Repository-Vorbereitung.** Der Branch
`feat/issue-63-terminology` wurde vorbereitet. Die gemeinsame
VS-Code-Konfiguration und die Ignore-Regeln wurden in einem separaten
Repository-Commit versioniert und anschließend in diesen Branch übernommen.
Diese Änderung betrifft keine Simulationslogik und keine Issue-63-
Terminologie.

**2026-10-07 – Fachliche Entscheidung.** Die Terminologie wurde anhand des
AI4REALNET Railway Network Use Case 2 und der Flatland-Grenzen präzisiert.
Insbesondere werden technische Fehler, betriebliche Störungen, Abweichungen,
Betriebsprogramme, Betriebsszenarien und Simulationsläufe getrennt behandelt.
Die Runbook-Reihenfolge mit PR A, PR B und PR C wurde als verbindliche
Umsetzungsreihenfolge festgelegt.

**2026-10-07 – Phase-0-Baseline.** Style-Lint und Produktionsbuild wurden
erfolgreich ausgeführt. Der Produktionsbuild meldet nur bestehende Warnungen.
Die Backend-Suite benötigte die projektkonforme Umgebung, weil der erste Lauf
wegen des fehlenden Moduls `pydantic_settings` nicht sammeln konnte.

**2026-10-07 – PR A bis C und Abschlussprüfung.** Glossar, sichtbare UI-Copy,
Terminologie-Guard, Frontend-Renames, Layout-Migration, Backend-Identifier,
API-Endpunkte, Fixtures und aktive Dokumentationsverweise wurden umgesetzt.
Der Terminologie-Guard, Style-Lint, Produktionsbuild und die Python-
Syntaxprüfung sind erfolgreich. `npm run i18n:check` bleibt wegen bestehender
Hardcoded-UI-Texte rot. Die vollständige Backend-Suite meldet `533 passed` und
zwei unabhängige Fehler; diese sind im Abschlussbericht dokumentiert.

**2026-10-07 – Umsetzungsstatus.** Die Prosa-Dokumentation und die vollständige
Terminologie-Tabelle sind angelegt. PR A, PR B und PR C sind umgesetzt. Die
verbleibenden offenen Punkte sind die bestehende i18n-Schuld sowie die zwei
unabhängigen Backend-Fehler; beide wurden nicht als Terminologie-Regression
behandelt.
