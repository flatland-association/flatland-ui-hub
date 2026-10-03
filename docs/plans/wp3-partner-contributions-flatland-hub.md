# WP3-Partnerbeiträge für den Flatland UI Hub

> **Status:** Vorschlag zur Abstimmung
> **Stand:** 2026-10-03
> **Ziel:** Konkrete, zeitnahe Anschlussarbeiten aus dem WP3-Update für den
> Flatland UI Hub festhalten. Der Plan baut auf dem bestehenden Hub auf und
> schlägt weder einen Ersatz des Director Mode noch eine parallele Plattform vor.

## Kurzfassung

Drei Vorhaben erscheinen mit dem aktuellen Entwicklungsstand des Hubs
realistisch und fachlich nützlich:

1. **Robustheit kontrolliert messen:** dieselbe Flatland-Situation mit und ohne
   eine einzelne, reproduzierbare Störung ausführen und die Auswirkungen auf
   Netz und Entscheidungen vergleichen.
2. **Präferenzen anhand realer Director-Pläne erfassen:** Menschen konkrete
   Zielkonflikte zwischen bereits berechneten Plänen vergleichen lassen und
   diese Wahl als zusätzliches Signal für das Operator-Modell erfassen.
3. **Unsicherheit vorhandener Prognosen kalibrieren:** mit Flatland-Ergebnissen
   prüfen, ob Conformal Prediction für ausgewählte Prognosen belastbare
   Vorhersageintervalle liefern kann, bevor solche Intervalle in der HMI
   angezeigt werden.

Das sind Anschlussarbeiten an vorhandene Hub-Funktionen, keine Übernahme der
Partneralgorithmen als fertige Railway-Komponenten. Die in den Folien
beschriebene Arbeit am Director Mode ist ein eigener Hub-Beitrag; der Director
und seine Planungs- und Präferenzfunktionen werden hier als bestehende Grundlage
behandelt.

## Ausgangslage im Hub

- Der Director plant vollständige Fahrpläne für mehrere Züge und bewertet sie
  nach **Pünktlichkeit, Anschlüssen und Stabilität**. Seine Strategie-Karten
  zeigen echte Planvarianten und deren Auswirkungen.
- Das Operator-Modell lernt bereits aus bewussten Entscheidungen und
  bestätigten Präferenzen. Es kann Präferenzprofile und Director-Gewichte
  vorschlagen; die Anwendung eines Vorschlags bleibt eine bewusste Entscheidung.
- Der Hub bietet What-if-Simulation, Szenario-Katalog, kontrollierte
  Störungsplanung und ein Risk-&-Uncertainty-Panel. Die Unsicherheitssignale
  des Panels sind noch nicht kalibriert.
- Für Netzwerk- und Human-AI-Evaluation gibt es bereits anschlussfähige
  Kennzahlen und Instrumente. Der Plan nutzt diese, statt neue KPIs parallel
  einzuführen.

## Arbeitspaket 1 — Kontrollierte Robustheits- und Wirkungsprüfung

**Bezug:** Flatland-Beitrag in den WP3-Folien; WP4-KPIs PF-026, NF-045 und
RS-058.
**Priorität:** hoch.
**Ziel:** herausfinden, wie stark eine einzelne kontrollierte Störung den
Netzwerkzustand, den geplanten Verkehr und menschliche beziehungsweise
algorithmische Entscheidungen beeinflusst.

### Vorgehen

1. Eine feste Netz- und Verkehrskonfiguration mit reproduzierbarem Seed
   auswählen.
2. Einen Lauf ohne zusätzliche Störung als Kontrollbedingung ausführen.
3. Einen ansonsten identischen Lauf mit einer einzelnen, gezielten Störung
   ausführen, zum Beispiel einer zeitlich und räumlich festgelegten
   Streckenblockierung oder einem gezielten Ausfall.
4. Für beide Läufe dieselbe Policy, dieselben Director-Gewichte und dieselben
   übrigen Bedingungen verwenden.
5. Kennzahlen und Planänderungen nebeneinander auswerten:
   - **PF-026:** Pünktlichkeit,
   - **NF-045:** Ausbreitung der Netzwerkwirkung,
   - **RS-058:** Robustheit gegenüber menschlichem Input, wo ein solcher Input
     Teil des Versuchs ist.

Der bestehende Flatland-Mechanismus für bedingte, zellbezogene
Malfunction-Ereignisse ist als möglicher technischer Einstieg zu prüfen. Der
bereits geplante Event-Layer kann die reproduzierbaren Ereignisse und Zeitfenster
bereitstellen.

### Ergebnis und Prüfkriterien

- Ein dokumentiertes, wiederholbar ausführbares Szenariopaar (Kontrolle und
  Störung).
- Ein Auswertungsbericht mit denselben Kennzahlen und erkennbarer Zuordnung
  zwischen Störung, betroffenen Zügen und Netzwerkwirkung.
- Wiederholte Ausführung mit denselben Einstellungen erzeugt vergleichbare
  Resultate; Änderungen sind auf die definierte Störung zurückführbar.
- Falls der Versuch menschliche Entscheidungen vergleicht, werden
  Entscheidungszeitpunkt, gewählte Aktion und Entscheidungskontext gemeinsam
  mit dem Ergebnis erfasst.

### Anschluss im Repository

- [Szenario-Varianten](./scenario-variants.md)
- [Scripted Events](./scripted-events-plan.md)
- [WP4-Validierungsabgleich](../reference/wp4-validation-alignment.md)
- `backend/app/core/` und Flatland-Mechanismen für gezielte Störungen

## Arbeitspaket 2 — Präferenzvergleich anhand berechneter Director-Pläne

**Bezug:** TUD-Beitrag zu interaktiver Mehrzieloptimierung und
Präferenzlernen; POLIMI-Beitrag zu IRL als methodischer Anschluss.
**Priorität:** hoch.
**Ziel:** bessere Präferenzsignale erfassen, indem Menschen konkrete
Planfolgen vergleichen, statt sie ausschliesslich nach einem abstrakten Ziel
oder einer Gewichtung zu fragen.

### Vorgehen

1. Die bestehenden Director-Strategien und ihre berechneten Pläne verwenden.
   Die Ziele Pünktlichkeit, Anschlüsse und Stabilität bleiben zunächst
   unverändert.
2. In einer Situation, in der die Alternativen tatsächlich unterschiedliche
   Folgen haben, zwei Planvarianten mit ihren vorhandenen Kennzahlen
   gegenüberstellen.
3. Eine freiwillige paarweise Wahl ermöglichen: welche der beiden Varianten
   bevorzugt die Person in dieser Situation? Optional kann sie den Grund
   angeben.
4. Zusammen mit der Wahl den relevanten Kontext, die verglichenen Optionen und
   deren ausgewiesene Kennzahlen protokollieren. Das ergänzt die vorhandenen
   Operator-Signale; es ändert nicht unmittelbar das Verhalten des Planners.
5. Die erfassten Entscheidungen zunächst auswerten: Stimmen die daraus
   abgeleiteten Präferenzen mit späteren oder zurückgehaltenen Entscheidungen
   überein? Ergibt sich ein Vorteil gegenüber den bisherigen Signalen?

Die Oberfläche soll nur dann zur Präferenzwahl einladen, wenn die angezeigten
Alternativen einen erkennbaren Unterschied aufweisen. Wenn die Pläne oder ihre
relevanten Kennzahlen praktisch gleich sind, wird keine künstliche Wahl
erzeugt.

### Ergebnis und Prüfkriterien

- Ein kleiner, mode-gerechter Vergleich bestehender Director-Pläne; kein neuer
  Planer und keine zweite Director-Oberfläche.
- Paarweise Wahl, Kontext und Kennzahlen sind im Entscheidungsprotokoll
  nachvollziehbar verknüpft.
- Die HMI zeigt, worin sich die Optionen unterscheiden, ohne eine davon als
  objektiv beste auszugeben.
- Eine Offline-Auswertung vergleicht die aus paarweisen Wahlen abgeleiteten
  Präferenzen mit den bisher erfassten Präferenzsignalen.
- Vor einer Verwendung zur automatischen Anpassung wird geprüft, ob genügend
  und hinreichend konsistente Daten vorliegen. Bis dahin bleibt die
  Präferenzwahl ein Erhebungs- und Evaluationssignal.

### Anschluss im Repository

- [Director Mode](../reference/director-mode.md)
- [Operator-Modell](./co-learning-direction.md)
- [Co-Learning über Modi hinweg](./colearning-across-modes.md)
- `frontend/src/app/features/strategy-options/`
- `frontend/src/app/core/operator-model.service.ts`
- `backend/app/core/operator_model.py`

## Arbeitspaket 3 — Kalibrierung von Prognoseunsicherheit evaluieren

**Bezug:** INESC TEC-Beiträge zu Unsicherheit, Failure Forecasting und
Conformal Prediction.
**Priorität:** parallel als begrenzte Machbarkeitsprüfung.
**Ziel:** ermitteln, ob Conformal Prediction ausgewählte Flatland-Prognosen
mit empirisch überprüfbarer Abdeckung versehen kann.

Die INESC-Artefakte und Modelle sind für Grid2Op beziehungsweise Stromnetze
entwickelt. Der übertragbare Beitrag ist hier zunächst die Kalibrierungsmethode,
nicht das Modell selbst.

### Vorgehen

1. Einen Prognosetyp auswählen, für den der Hub sowohl Vorhersage als auch
   später beobachtbares Ergebnis hat, beispielsweise eine Verspätungsprognose
   oder die Prognose einer Szenario-KPI.
2. Für mehrere Flatland-Szenarien und Seeds Vorhersage-Istwert-Paare erzeugen
   und nach Szenario beziehungsweise Seed in Kalibrierungs- und Testdaten
   aufteilen.
3. Auf dem Kalibrierungsteil Conformal Prediction um den vorhandenen
   Prognoseweg legen; das zugrunde liegende Planungs- oder Prognosemodell
   bleibt unverändert.
4. Auf unabhängigen Testdaten empirische Abdeckung und Intervallbreite
   auswerten. Zielabdeckung und akzeptable Breite werden vorab mit dem
   Forschungsteam festgelegt.
5. Erst bei nachvollziehbaren Testergebnissen die Darstellung im bestehenden
   Risk-&-Uncertainty-Panel konkretisieren. Bis dahin werden die Signale nicht
   als kalibrierte Zuverlässigkeit bezeichnet.

### Ergebnis und Prüfkriterien

- Ein dokumentierter Flatland-Datensatz mit nachvollziehbarer Trennung von
  Kalibrierungs- und Testfällen.
- Ein Offline-Ergebnis mit empirischer Abdeckung und Intervallbreite auf
  unabhängigen Testszenarien.
- Ein Go/No-Go zur Integration in das Risk-&-Uncertainty-Panel, begründet
  anhand der vorab vereinbarten Qualitätskriterien.
- Kein Konfidenz- oder Intervallversprechen in der HMI, solange die
  Kalibrierung nicht anhand unabhängiger Daten geprüft wurde.

### Anschluss im Repository

- [Widget A1 — Risk & Uncertainty](./widget-a1-risk-uncertainty.md)
- [Interaktions- und Evaluationsrahmen](../reference/interaction-framework.md)
- `backend/app/core/recommendation_generator.py`
- `frontend/src/app/features/risk-uncertainty/`

## Reihenfolge und Abstimmung

1. **Szenario und Messgrössen abstimmen:** einen geeigneten Netz-/Verkehrsfall,
   eine kontrollierte Störung und die für den Versuch relevanten KPIs festlegen.
2. **Robustheitsvergleich umsetzen:** die Kontroll- und Störungsbedingung
   reproduzierbar machen und die Auswertung prüfen.
3. **Präferenzvergleich prototypisieren:** auf vorhandenen Director-Plänen
   aufsetzen und die paarweise Wahl als zusätzliche Beobachtung protokollieren.
4. **Unsicherheitskalibrierung parallel prüfen:** Prognosetyp, Datenbasis und
   Erfolgskriterien festlegen; erst danach über eine UI-Integration entscheiden.

Vor dem Start sollten die Beteiligten Netz und Verkehr für den Versuch,
Störungsdefinition, Vergleichs-KPIs, gewünschte Zielabdeckung für
Unsicherheitsintervalle und Umgang mit den erhobenen Operator-Daten bestätigen.

## Partnerbeiträge und Quellen

Die Zuordnung beschreibt fachliche Anknüpfungspunkte aus dem
WP3-Update-Deck, keine Aussage über eine vereinbarte gemeinsame Umsetzung:

- **Flatland / WP4:** Mehrziel-Fähigkeiten, Störungsrobustheit und
  Railway-KPIs (Folien 52–54).
- **TUD:** interaktive Mehrzieloptimierung und Erhebung von Präferenzen
  (Folien 27–29).
- **POLIMI:** IRL und risikosensitive/risk-neutrale Verhaltensmodelle
  (Folien 19–21); in diesem Plan zunächst als Motivation für bessere
  Präferenzdaten, nicht als neue Lernalgorithmus-Integration.
- **INESC TEC:** Unsicherheits- und Conformal-Prediction-Arbeiten
  (Folien 11–13); Übertragung auf Flatland wird empirisch geprüft.
