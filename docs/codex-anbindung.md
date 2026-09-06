# Lokale Codex-Anbindung

Das Teststudio ruft die vorhandene Codex CLI auf dieser Maschine auf. Die fachlichen Entwürfe, die technische Planung, die unabhängige Dublettenprüfung und die Wiederverwendungsvorschläge entstehen in echten Modellaufrufen. Die Anwendung enthält keinen regelbasierten Textplaner, der einen erfolgreichen KI-Lauf vortäuscht.

Luna wird ausdrücklich als `gpt-5.6-luna` aufgerufen, Sol als `gpt-5.6-sol`. Die Auswahl erfolgt im Teststudio und bleibt im gespeicherten Modellmanifest sichtbar. Ist das gewählte Modell nicht erreichbar oder nicht freigeschaltet, zeigt der Auftrag den tatsächlichen Fehler. Die Anwendung ersetzt es nicht still durch ein anderes Modell.

Die installierte CLI bestätigt mit `codex exec --help` den nicht interaktiven Aufruf, JSON-Ereignisse und ein JSON-Ausgabeschema. `-p` bezeichnet ein Konfigurationsprofil. Einen Prompt übergibt die Anwendung über stdin an `codex exec -`. Das entspricht der [offiziellen Dokumentation zum nicht interaktiven Modus](https://learn.chatgpt.com/docs/non-interactive-mode).

Ein Aufruf sieht strukturell so aus:

```sh
codex exec --ignore-user-config --ephemeral --json --color never \
  --sandbox read-only -c 'approval_policy="never"' \
  --skip-git-repo-check \
  --output-schema /abgegrenzter/auftrag/schema.json \
  -o /abgegrenzter/auftrag/result.json \
  -m gpt-5.6-luna -C /abgegrenzter/auftrag -
```

Der Adapter startet das Programm mit einer Argumentliste und ohne Shell. Nutzertext wird deshalb weder als Shellbefehl noch als Dateiname ausgewertet. Die bestehende lokale Anmeldung verwendet die CLI selbst. Die Anwendung liest, kopiert und veröffentlicht keine Anmeldedateien. `--ignore-user-config` verhindert, dass persönliche Modellvorgaben oder zusätzliche Werkzeuge den abgegrenzten Auftrag verändern; die bestehende Authentifizierung bleibt erhalten. Die innere Agentensandbox ist schreibgeschützt.

## Die fachliche Runde

Der Agent erhält den deutschen Auftrag, den versionierten Blockkatalog und kuratierte Fachtexte. Dateien mit technischen Portalquellen werden erst in der technischen Runde beigefügt. Das Ausgabeschema lässt neue elementare Definitionen und neue Wissensdokumente ausdrücklich zu. Der Ablauf kann deshalb bei einem leeren Blockkatalog beginnen.

Beliebige Eingabefelder erscheinen im CLI-Ausgabeschema als Zeilen mit `key` und `valueJson`. Die Anwendung wandelt diese Zeilen in echte Zahlen, boolesche Werte, Objekte, Referenzen und Parameter um. Anschließend prüft sie die erlaubten Typen, verschachtelten Schemata, Referenzen, fachlichen Pflichtfelder und Kompositionen. `valueJson` ist ein Datenwert und wird niemals als Programm ausgeführt.

Bei einem Schema- oder Compilerfehler erhält dasselbe Modell einmal die vorherige Antwort und den konkreten Validierungsbericht. Diese Korrektur ist ein weiterer echter CLI-Aufruf mit eigenen Artefakten. Bleibt ein fachlicher Entwurf unvollständig, zeigt die Oberfläche seine Fehler; eine Freigabe ist dann nicht möglich. Erklärungen und Notizen ersetzen keine Assertion.

Der Mensch kann die Blöcke verschieben, verschachteln und ihre typisierten Werte ändern. Die Freigabe speichert die Szenariorevision und einen Fingerprint aus Ablauf, verwendeten fachlichen Definitionen und Wissen. Eine Änderung der Summe oder eines enthaltenen Schritts macht die Freigabe veraltet. Eine rein technische Locatorreparatur verändert diese fachliche Freigabe dagegen nicht.

## Technik, Dubletten und Probelauf

Nach der Freigabe starten zwei unabhängige CLI-Aufrufe parallel. Auch technische Planung, Dublettenprüfung und Wiederverwendung besitzen jeweils höchstens einen echten Korrekturversuch anhand eines konkreten Schema- oder Referenzfehlers. Prüfgegenstände und erlaubte Parameternamen werden im jeweiligen Ausgabeschema auf den freigegebenen Ablauf begrenzt. Der technische Agent prüft UI-Bindungen. Der Dublettenagent vergleicht Bedeutung, Schema, Vorbedingungen, Ergebnisse und Kompositionen mit dem vorhandenen Katalog.

Der technische Agent erhält die freigegebene Momentaufnahme, vorhandene Bindungen und einen sicheren Index der aktuellen TypeScript-Dateien unter `src/portal`. Er kann bestehende Bindungsrevisionen wählen oder neue deklarative Rezepte erzeugen. Der Executor kennt allgemeine UI-Aktionen wie Eingabe, Auswahl, Klick und Prüfung. Er enthält keinen Schalter auf bekannte fachliche Block-IDs.

Die Anwendung validiert jedes neue Rezept vor der Übernahme. Es darf nur lokale `/portal`-Routen öffnen und bekannte Locatorarten nutzen. Speicheraktionen erfassen die reale HTTP-Antwort ihres UI-Klicks. Damit werden konkrete Kunden-, Betriebs-, Tier-, Vorschlags-, Vertrags- und Dokument-IDs verknüpft. Parent-IDs können zusätzlich gegen die Antwort geprüft werden. Ein gesetztes Fachfeld muss im tatsächlich ausgeführten Rezept gesetzt oder geprüft werden; andernfalls schlägt der kleinste Block sichtbar fehl.

Eine Assertion kann über `proof` ihr bestandenes boolesches Ergebnis und den tatsächlich gelesenen UI-Text ausgeben. Diese Ergebniswerte entstehen erst nach erfolgreicher Browserprüfung.

Ein automatisch geöffnetes Formular ist ein expliziter UI-Zustand. `unlessVisible` darf einen reinen Öffnungsklick nur überspringen, wenn das benannte Formularfeld tatsächlich sichtbar ist. Es überspringt keine fachliche Speicheraktion und schluckt keine fehlgeschlagenen Selektoren.

Für die Browserausführung werden genau die vom Agenten geprüften Bindungsrevisionen eingefroren. Neue Bindungen werden als vollständiges Set geprüft und atomar gespeichert. Hat der Mensch während der Agentenarbeit den Fachablauf geändert, wird das Ergebnis als veraltet behandelt. Die technische Runde kann keine neue fachliche Freigabe erteilen.

Ein Dublettenfund führt zur sichtbaren Entscheidung. Ein gleichwertiger vorhandener Block kann übernommen werden; daraus entsteht eine neue fachliche Revision zur erneuten Prüfung. Eine notwendige Erweiterung bleibt als konkrete Fachaufgabe sichtbar. Die Anwendung ersetzt dabei keine Fachsemantik still im Hintergrund.

Nach der Verdrahtung öffnet Chromium das Versicherungsportal und führt den Ablauf tatsächlich aus. Der Lauf speichert jeden elementaren Pfad, Screenshots, einen Playwright-Trace, die konkrete Bindungsrevision und die erzeugten Objekt-IDs. `generated.spec.ts` importiert den zentralen generischen Executor und verwendet die eingefrorenen Daten aus `compiled.json`. Selektoren werden nicht in jeden generierten Test kopiert.

## Wiederverwendung und Reparatur

Erst nach einem erfolgreichen Browserlauf erhält ein weiterer Codex-Agent den geprüften Ablauf und die Laufnachweise. Er schlägt passende Kompositionen und veränderliche Parameter vor. Der Mensch kann Namen und Parameter bearbeiten, Vorschläge annehmen oder verwerfen. Die Annahme prüft nochmals den exakt erfolgreich getesteten Fachstand. Verschachtelte Vorschläge benennen ihre übergeordnete Ebene mit `parentPath`; angenommen wird jeweils ein Vorschlag. Eine fehlgeschlagene Wiederverwendungsprüfung kann auf dem bereits bestandenen Lauf erneut gestartet werden, ohne erneut Versicherungsobjekte anzulegen.

Wenn ein Portalbutton umbenannt wird, scheitert der kleinste technische Block. Der Einflussbericht verfolgt die Bindung durch direkte Verwendungen und enthaltene Workflows bis zu allen betroffenen Testfällen. Ein Reparaturauftrag enthält den fehlgeschlagenen Lauf, die alte Bindung und die aktuellen Portalquellen. Der Agent liefert eine neue Revision derselben Bindung. Alte Läufe behalten ihre ursprünglichen Selektoren und Nachweise.

## Konfiguration und Betrieb

| Variable | Bedeutung |
| --- | --- |
| `FOLIO_CODEX_EXECUTABLE` | Pfad zur Codex CLI; ansonsten `/opt/homebrew/bin/codex`, falls vorhanden, sonst `codex` aus PATH |
| `FOLIO_CODEX_TIMEOUT_MS` | Zeitlimit pro CLI-Aufruf, standardmäßig 300000 ms, höchstens 1800000 ms |
| `FOLIO_AGENT_ARTIFACTS_ROOT` | Agentennachweise, standardmäßig `.local/testing/agents` |
| `FOLIO_TESTING_RUN_ROOT` | Browsernachweise, standardmäßig `.local/testing/runs` |
| `FOLIO_APP_URL` | Adresse des Portals, standardmäßig `http://127.0.0.1:5173` |
| `FOLIO_AUTO_REUSE=0` | Deaktiviert ausschließlich die automatische KI-Nachprüfung erfolgreicher Browserläufe, beispielsweise auf einem isolierten Testserver. Es wird kein KI-Ergebnis simuliert. Standardmäßig ist sie aktiv. |

Der Adapter begrenzt die CLI-Aufrufe der Anwendung auf zwei gleichzeitige Kindprozesse. Weitere Aufträge warten. Ein Abbruch beendet die zugehörige Prozessgruppe, auch bei einer Warteposition oder direkt vor dem Start. Ein Zeitlimit beendet einen hängenden Aufruf. Beim Neustart werden unterbrochene Aufträge als abgebrochen markiert; anhand gespeicherter PID und des exakten Auftragsverzeichnisses werden noch laufende zugehörige Codex-Prozesse erkannt und beendet. Ein altes `result.json` wird vor jedem erneuten Aufruf entfernt und kann keinen neuen Erfolg vortäuschen.

`npm run dev:stable` hält den Backendprozess während einer Vorführung stabil. Ein laufender Agenten- oder Browserauftrag sollte vor einer bewussten Backendänderung beendet werden. Der Frontendcode aktualisiert sich weiterhin über Vite.

## Prüfen

`server/testing/agents/pipeline.test.ts` prüft den Prozessvertrag mit einer ausdrücklich als Testfixture benannten lokalen CLI. Das sind keine Belege für Modellqualität oder echten KI-Erfolg. Es prüft Argumente, globale Parallelität, Abbruch, veraltete Antworten, technische Eingabeabdeckung und eine Szenarioänderung während der Agentenarbeit.

`e2e/testing-runtime.spec.ts` prüft echte Browserläufe mit getrennten Testdaten, eine neu definierte freie Assertion sowie einen absichtlich veralteten Button und die zentrale Reparatur. Echte Luna-/Sol-Aufrufe werden separat im lokalen System durchgeführt; ihre Prompts, Modelle, Schemas und Ergebnisse bleiben als Agentenartefakte erhalten.

Konkrete lokale Abnahmebelege und ihre Grenzen stehen in [Pipeline-Nachweise](pipeline-nachweise.md).
