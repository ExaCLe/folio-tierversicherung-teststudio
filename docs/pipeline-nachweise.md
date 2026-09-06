# KI- und Browserpipeline prüfen

Diese Anleitung beschreibt die Abnahme der fachlichen Entwürfe, technischen Bindungen und Browserausführung. Sie verwendet fiktive Tierversicherungen. Agentenantworten, Screenshots, Traces und Versicherungsobjekte entstehen bei der lokalen Durchführung. Diese Nachweise sind nicht im Repository enthalten.

## Vorbereitung

Installiere und starte die Anwendung nach der [README](../README.md#schnellstart). Für die Modellprüfungen muss die lokale Codex CLI eingerichtet sein. Die [Codex-Anbindung](codex-anbindung.md) beschreibt Voraussetzungen, Modellwahl und gespeicherte Aufträge. Der [Demoguide](demo-walkthrough.md) erklärt die Bedienung des Studios.

Die automatischen Prüfungen lassen sich aus dem Projektverzeichnis starten:

```sh
npm test
npm run test:e2e -- e2e/testing-runtime.spec.ts
```

Die Browserprüfung startet eigene Testserver und verwendet getrennte Testdaten. Die CLI-Vertragstests arbeiten mit einer ausdrücklich als Fixture angelegten CLI. Die Qualität eines echten Luna- oder Sol-Vorschlags wird durch die folgenden manuellen Modellprüfungen beurteilt.

## Fachlichen Entwurf und Technik abnehmen

Gib im Teststudio unter "Deine Anforderung" beispielsweise ein:

> Versichere einen Schweinebestand mit 120 Tieren auf einem Betrieb in Bayern. Verwende Stallhaltung, erfüllte Biosicherheit und 600.000 Euro Versicherungssumme. Berechne ein Angebot und reiche den Antrag ein. Prüfe, dass eine offene Direktionsanfrage besteht und noch kein Vertrag abgeschlossen wurde.

1. Wähle Luna oder Sol und starte "Fachlichen Entwurf erstellen". Prüfe im Agentenauftrag, welches Modell tatsächlich verwendet wurde und ob der Auftrag erfolgreich abgeschlossen ist.
2. Öffne "Entwurf ansehen". Prüfe Tierart, Bestandsgröße, Haltungsform, Biosicherheit, Summe, Betriebsstandort und das erwartete Ende des Ablaufs.
3. Kontrolliere die verwendeten Definitionen und Wissensbelege. Speichere den passenden Entwurf und wähle "Fachlich freigeben".
4. Starte "Technik & Probelauf". Prüfe fehlende Bindungen, Rückfragen, Korrekturversuche und mögliche Dublettenentscheidungen.
5. Öffne den abschließenden Browserlauf unter "Ausführungen". Prüfe die einzelnen Schritte und den erzeugten Vorgang im Portal.

Für eine bestandene Abnahme müssen folgende Ergebnisse zusammenpassen:

| Prüfgegenstand | Erwartung |
| --- | --- |
| Versicherter Bestand | 120 Schweine, Stallhaltung, erfüllte Biosicherheit, 600.000 EUR Summe |
| Betrieb | Bundesland Bayern |
| Vorschlag | Status Direktionsprüfung und offene Direktionsanfrage |
| Abschluss | Kein Vertrag und keine Police entstanden |
| Ausführung | Alle vorgesehenen Schritte bestanden; Statusprüfung durch gelesenen Portalinhalt belegt |
| Gespeicherter Stand | Freigabe, fachlicher Ablauf und ausgeführte Bindungsrevisionen stimmen überein |

Wiederhole die Modellprüfung mit dem anderen Modell, wenn beide angeboten werden sollen. Die Zahl neu vorgeschlagener Definitionen oder technischer Korrekturen kann zwischen Modellläufen variieren. Fehler und abgewiesene Antworten gehören zum jeweiligen lokalen Prüfprotokoll.

## Kaltstart mit leerem Definitionskatalog

Ein frisch gestartetes Studio enthält die ausgelieferten Beispieldefinitionen. Für eine gesonderte Kaltstartprüfung muss der fachliche Agent einen leeren Definitionskatalog und das kuratierte Portalwissen erhalten. Dafür enthält das Repository keinen eigenen npm-Befehl; dieser Prüfaufbau muss separat vorbereitet werden.

Die Abnahme verlangt ein gespeichertes Eingabekatalog-Snapshot, aus dem der leere Definitionsbestand hervorgeht. Der fachliche Agent muss die benötigten Definitionen vorschlagen. Nach fachlicher Prüfung muss die technische Runde passende deklarative Bindungen erzeugen. Der anschließende Browserlauf muss dieselben fachlichen Erwartungen wie oben erfüllen. Vorhandene Seedbindungen als Ausgangspunkt würden einen anderen Prüfaufbau belegen.

## Einen generierten Test wiederholen

Ein abgeschlossener Studiolauf legt unter den Standardeinstellungen Dateien in `.local/testing/runs/LAUF_ID/` an. Ersetze `LAUF_ID` durch die Kennung eines eigenen vorhandenen Laufs. Für den folgenden Befehl muss die Anwendung auf Port 5173 laufen:

```sh
FOLIO_REPLAY=1 FOLIO_E2E_APP_URL=http://127.0.0.1:5173 \
  npx playwright test .local/testing/runs/LAUF_ID/generated.spec.ts
```

Der generierte Test verwendet die zugehörige `compiled.json` und den zentralen Executor. Die Wiederholung erzeugt neue fiktive Portalobjekte. Dokumentiere ihr Ergebnis getrennt vom ursprünglichen Studiolauf.

Den Trace des ursprünglichen Laufs öffnest du mit:

```sh
npx playwright show-trace .local/testing/runs/LAUF_ID/trace.zip
```

## Eine zentrale Bindung reparieren

Die enthaltene Browserregression erzeugt eine isolierte Bindung mit absichtlich veraltetem Buttonnamen, beobachtet den Fehler am kleinsten Schritt und speichert anschließend eine korrigierte Bindungsrevision:

```sh
npm run test:e2e -- e2e/testing-runtime.spec.ts --grep "Veralteter Button"
```

Geprüft werden der fehlgeschlagene Kundenblock, die indirekte Verwendung in einem zusammengesetzten Ablauf, der erfolgreiche Folgelauf und die unveränderte Historie. Der fachliche Fingerprint bleibt gleich; der alte Lauf behält die fehlerhafte Bindungsrevision. Diese Regression setzt die technische Korrektur selbst über die API.

Für eine zusätzliche Abnahme der KI-Reparatur muss ein echter Reparaturauftrag mit dem fehlgeschlagenen Lauf, der alten Bindung und den aktuellen Portalquellen ausgeführt werden. Prüfe, dass nur die betroffene zentrale Bindung eine neue Revision erhält. Führe die über den Einflussbericht ermittelten Testfälle erneut aus und halte fest, welche davon geprüft wurden. Nicht ausgeführte Abläufe erhalten kein bestandenes Ergebnis.

## Lokale Nachweise aufbewahren

| Nachweis | Standardverzeichnis |
| --- | --- |
| Modellauftrag, Schema und Antwort | `.local/testing/agents/` |
| Kompilierter Stand, Laufmanifest, Screenshots, Trace und generierter Test | `.local/testing/runs/` |
| Automatischer Playwright-Bericht | `.local/playwright-report/` |

Git ignoriert diese Verzeichnisse. Ein Clone enthält die Quelltests und diese Anleitung; Ergebnisse einer eigenen Durchführung entstehen erst lokal. Die [Teststudio-API](testing-api.md) beschreibt den Zugriff auf gespeicherte Läufe und Artefakte.
