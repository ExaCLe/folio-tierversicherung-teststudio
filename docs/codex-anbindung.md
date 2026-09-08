# Lokale KI-Anbindung

Das Teststudio ruft die lokal installierte Codex CLI oder Claude Code auf dem Rechner der API auf. Die fachlichen Entwürfe, die technische Planung, die unabhängige Dublettenprüfung und die Wiederverwendungsvorschläge entstehen in echten Modellaufrufen. Die Anwendung enthält keinen regelbasierten Textplaner, der einen erfolgreichen KI-Lauf vortäuscht.

Luna ist als `gpt-5.6-luna` vorkonfiguriert, Sol als `gpt-5.6-sol`. Unter „Einstellungen“ lassen sich weitere Modellprofile mit Anzeigename, Provider, Modell-Slug und zusätzlichen Argumenten speichern. Die Auswahl erfolgt im Teststudio und bleibt im gespeicherten Modellmanifest sichtbar. Ist das gewählte Modell nicht erreichbar oder nicht freigeschaltet, zeigt der Auftrag den tatsächlichen Fehler. Die Anwendung ersetzt es nicht still durch ein anderes Modell.

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

## Claude Code und eigene Modelle

Claude Code wird im nicht interaktiven Modus mit `--print`, `--output-format stream-json`, `--verbose`, `--json-schema` und `--model` gestartet. Die Anwendung liest das Feld `structured_output` aus dem erfolgreichen abschließenden `result`-Ereignis. Ein Fehlerergebnis oder ein fehlendes strukturiertes Ergebnis gilt nicht als Erfolg. Diese Ausgabeformate beschreibt die [offizielle Dokumentation](https://code.claude.com/docs/en/headless).

Die Claude-Anbindung erlaubt ausschließlich die lesenden Werkzeuge `Read`, `Glob` und `Grep`. `--safe-mode`, leere Einstellungssourcen und eine leere strikte MCP-Konfiguration schalten persönliche Anpassungen und zusätzliche Werkzeuge für den Auftrag aus. Die normale CLI-Anmeldung bleibt verwendbar. Es gibt keine automatische Berechtigungsumgehung. Eine aktuelle Claude-Code-Version muss die verwendeten Flags unterstützen; `claude --help` zeigt die Fähigkeiten der Installation.

Provider- und Modellprofile werden lokal in der Kollektion `testingAgentSettings` derselben JSON-Datendatei gespeichert. Ein Auftrag hält eine Kopie der verwendeten Konfiguration als `agentConfig` fest. Auch seine Korrekturversuche und zugehörigen Agentenschritte verwenden diese Kopie. Ein späterer Wechsel der Einstellungen verändert laufende Aufträge nicht. Alte Aufträge ohne diesen Zusatz bleiben lesbar.

Das Feld für zusätzliche Argumente verarbeitet Anführungszeichen und Escapezeichen, führt aber keine Shell, Variablen oder Befehlsersetzungen aus. Das Modell wird über das Modellprofil gesetzt. Ausgabeformat, Werkzeuge, Arbeitsverzeichnis und Berechtigungen gehören zum Ausführungsvertrag und lassen sich nicht über Zusatzargumente überschreiben.

Unterstützte Zusatzargumente:

| Provider | Argumente |
| --- | --- |
| Claude Code | `--effort low`, `medium`, `high`, `xhigh` oder `max`; `--max-budget-usd` mit einem positiven Betrag |
| Codex | `-c model_reasoning_effort=high` mit `minimal`, `low`, `medium`, `high`, `xhigh`, `max` oder `ultra`; `-c model_verbosity=low` mit `low`, `medium` oder `high` |

Die installierte CLI und das gewählte Modell müssen den Wert unterstützen. Andere Zusatzargumente werden beim Speichern mit einer Erklärung abgelehnt. Bei mehrfach angegebenen Optionen gilt der letzte Wert; Modellargumente überschreiben dieselbe Provideroption. Bei Codex erfolgt dies getrennt je Konfigurationsschlüssel.

Beispiel für ein Claude-Code-Profil:

- Anzeigename `Claude mit hoher Denktiefe`
- Provider `Claude Code`
- Modellname / Slug `sonnet`, oder ein auf dem eigenen Konto verfügbarer Modellname
- Zusätzliche Modellargumente `--effort high`

Ein leeres Feld „CLI-Programm“ verwendet die Umgebungsvariable beziehungsweise den lokalen Standardpfad. Ein eingetragener Pfad enthält nur das Programm. Die Anwendung hängt ihre Argumente selbst an. Die Modell-Slugs werden unverändert an den gewählten Provider übergeben und nicht auf eine andere Modellfamilie umgeschrieben.

## Einen vorhandenen Ablauf überarbeiten

„Ablauf mit KI überarbeiten“ startet eine eigene fachliche Runde für den gespeicherten Testfall. Der Agent erhält den vollständigen Ablauf, die verschachtelten Blockpositionen, vorhandene Definitionen und das Fachwissen. Er kann Schritte einfügen, entfernen, umordnen oder Werte ändern und bei Bedarf neue Definitionen samt Wissen vorschlagen.

Das Ergebnis bleibt zunächst im Agentenauftrag. Der Testfall und der Katalog ändern sich erst durch „Ablaufänderung übernehmen und speichern“. Die Oberfläche zeigt die ursprüngliche Fassung, den Vorschlag und die Unterschiede. Der Vorschlag bleibt auch nach einem Seitenwechsel über den Auftrag erreichbar.

Die Annahme prüft Ausgangsrevision und Fachfingerprint erneut und speichert den neuen Ablauf samt neuen Definitionen und Wissensverweisen atomar. Veraltete Vorschläge können den aktuellen Stand nicht überschreiben. Der geänderte Ablauf benötigt eine neue Fachfreigabe, bevor die technische Runde ihn umsetzt. Frühere Laufnachweise behalten ihre ursprüngliche Momentaufnahme.

## Titel und kurze Beschreibung

Ein neuer Auftrag wird sofort als „Neuer Testfall“ gespeichert. Vor der Erkundung startet ein eigener Luna-Teilauftrag zur Benennung. Er erhält die Anforderung und gegebenenfalls den bisherigen Titel, erzeugt einen kurzen deutschen Titel, eine Zusammenfassung des Testziels und Themenbegriffe. Diese Texte beschreiben das Ziel, nicht einen bereits erfolgreichen Test.

Gibt die Anforderung ausdrücklich einen Titel vor, soll Luna ihn wortgetreu übernehmen. Die Antwort muss dafür die entsprechende Textstelle zitieren; die Anwendung prüft, dass sie tatsächlich in der Anforderung steht. Bereits brauchbar benannte Entwürfe werden bei einer unveränderten Wiederholung nicht erneut umbenannt. Eine inzwischen bearbeitete Fassung darf auch durch ein später eintreffendes Benennungsergebnis nicht überschrieben werden.

Die Benennung verwendet ein eingerichtetes Codex-Profil mit dem Slug `gpt-5.6-luna`, unabhängig vom Modell für die anschließende fachliche Arbeit. Fehlt dieses Profil oder schlägt die Benennung fehl, bleibt der Entwurf mit seinem bisherigen Titel bearbeitbar. Die fachliche Arbeit kann fortgesetzt werden; die Anwendung ersetzt Luna nicht still durch ein anderes Modell.

Am 8. September 2026 wurde dieser Helfer mit zwei echten Luna-Aufrufen und ausschließlich neu formulierten synthetischen Anforderungen geprüft. Er erzeugte einen kurzen Titel samt Zusammenfassung und Themenbegriffen und übernahm einen in Anführungszeichen vorgegebenen Titel exakt. Beide Antworten bestanden die strukturierte Validierung im ersten Versuch. Dieser Nachweis betrifft die Benennung; er belegt keinen vollständigen Versicherungsablauf.

## Die fachliche Runde

Der Agent erhält den deutschen Auftrag, den versionierten Blockkatalog und kuratierte Fachtexte. Dateien mit technischen Portalquellen werden erst in der technischen Runde beigefügt. Das Ausgabeschema lässt neue elementare Definitionen und neue Wissensdokumente ausdrücklich zu. Der Ablauf kann deshalb bei einem leeren Blockkatalog beginnen.

Beliebige Eingabefelder erscheinen im CLI-Ausgabeschema als Zeilen mit `key` und `valueJson`. Die Anwendung wandelt diese Zeilen in echte Zahlen, boolesche Werte, Objekte, Referenzen und Parameter um. Anschließend prüft sie die erlaubten Typen, verschachtelten Schemata, Referenzen, fachlichen Pflichtfelder und Kompositionen. `valueJson` ist ein Datenwert und wird niemals als Programm ausgeführt.

Bei einem Schema- oder Compilerfehler erhält dasselbe Modell einmal die vorherige Antwort und den konkreten Validierungsbericht. Diese Korrektur ist ein weiterer echter CLI-Aufruf mit eigenen Artefakten. Bleibt ein fachlicher Entwurf unvollständig, zeigt die Oberfläche seine Fehler; eine Freigabe ist dann nicht möglich. Erklärungen und Notizen ersetzen keine Assertion.

Der Mensch kann die Blöcke verschieben, verschachteln und ihre typisierten Werte ändern. Die Freigabe speichert die Szenariorevision und einen Fingerprint aus Ablauf, verwendeten fachlichen Definitionen und Wissen. Eine Änderung der Summe oder eines enthaltenen Schritts macht die Freigabe veraltet. Eine rein technische Locatorreparatur verändert diese fachliche Freigabe dagegen nicht.

## Wissen prüfen und die Anwendung erkunden

Nach der Benennung beginnt die fachliche Arbeit mit der Prüfung des vorhandenen Wissens und Blockkatalogs. Reicht dieses Wissen aus, kann die KI direkt einen Entwurf erstellen. Bei Lücken steht ihr eine kontrollierte Anwendungserkundung zur Verfügung.

Die CLI liefert dafür strukturierte Browseraktionen. Die Anwendung führt sie mit Playwright gegen eine separate lokale Portalinstanz aus und gibt die beobachtete Oberfläche an die nächste Modellrunde zurück. Der Browser verwendet eine eigene Datenbank mit synthetischen Ausgangsdaten. Die Erkundung greift nicht auf den laufenden Versicherungsbestand zu. Die CLI erhält dadurch keinen allgemeinen Shell- oder Browserzugriff.

Die Erkundung ist begrenzt und abbrechbar. Aktionen und Beobachtungen dienen als Belege für neues Wissen. Wenn die Anwendung eine Fähigkeit nicht zeigt oder eine Frage offen bleibt, muss dies im Ergebnis sichtbar bleiben. Eine UI-Beobachtung ist keine automatisch bestätigte fachliche Regel.

Die aktuelle Browserbeobachtung und der benötigte Wissenskontext werden als abgegrenzte Daten direkt an die Modellanfrage übergeben. Dateien bleiben zusätzlich als Nachweis erhalten. Der nächste Browserzugriff hängt dadurch nicht von einem Dateilesewerkzeug des jeweiligen CLI-Modells ab.

Auch frühere Beobachtungen müssen ihren relevanten sichtbaren Inhalt behalten. Nur eine Belegnummer und die besuchte Adresse reichen nicht aus, wenn beispielsweise ein deaktivierter Entscheidungsbutton für eine bestimmte Rolle nachgewiesen wurde. Wiederkehrende Zustände und fehlende neue Erkenntnisse führen zu einer abschließenden Auswertung der vorhandenen Belege. Nicht geklärte Fragen bleiben dabei ausdrücklich offen.

Ein internes Zeitlimit wird als Zeitlimit erfasst. Nur ein ausdrücklich ausgelöster Nutzerabbruch darf als solcher angezeigt werden. Ein unspezifisches Abbruchsignal belegt keinen Nutzerabbruch. Öffentliche Arbeitsschritte und Erläuterungen stehen getrennt von technischen Prozessmeldungen zur Verfügung; die übergeordnete Koordination zählt nicht zusätzlich zu ihren arbeitenden Teilaufträgen.

Der Testfall existiert bereits vor der ersten Modellantwort als gespeicherter Entwurf. Aufträge und Teilaufträge gehören zu diesem Testfall. Ergebnisse dürfen eine inzwischen geänderte Fassung nicht überschreiben. Ein abgebrochener erster Auftrag kann mit demselben Testfall fortgesetzt werden.

## Technik, Dubletten und Probelauf

Nach der Freigabe starten zwei unabhängige CLI-Aufrufe parallel. Auch technische Planung, Dublettenprüfung und Wiederverwendung besitzen jeweils höchstens einen echten Korrekturversuch anhand eines konkreten Schema- oder Referenzfehlers. Prüfgegenstände und erlaubte Parameternamen werden im jeweiligen Ausgabeschema auf den freigegebenen Ablauf begrenzt. Der technische Agent prüft UI-Bindungen. Der Dublettenagent vergleicht Bedeutung, Schema, Vorbedingungen, Ergebnisse und Kompositionen mit dem vorhandenen Katalog.

Das Dublettenschema bindet jede Entscheidung an das exakte Paar aus Definitions-ID und Version ihres Prüfgegenstands. Für `reuse` und `extend` darf `chosen` nur die vorhandene Version eines anderen Blocks nennen. Alle Versionen mit derselben Definitions-ID sind als Vergleichskandidaten ausgeschlossen; ihre Auswahl gehört zur expliziten Versionspflege. Der Agent erhält die erlaubten Vergleichskandidaten je Prüfgegenstand separat. Die Entscheidung `new` mit `chosen: null` bedeutet, dass keine passende andere Definition gefunden wurde. Sie ist auch für einen bereits gespeicherten eigenen Block möglich. Die Herkunft eines Blocks als menschliche oder agentische Definition sagt nicht aus, dass er gerade erst angelegt wurde.

Dynamische Schemas werden als unabhängige JSON-Wertbäume aufgebaut. Begründungen und Erläuterungen bleiben freie Texte. Die Anwendung prüft zusätzlich, ob jeder Prüfgegenstand genau einmal beurteilt wurde. Bei mehreren ungültigen Entscheidungen erhält die Korrekturrunde alle festgestellten Fehler zusammen. Ein Selbstvergleich wird weder als gültiger Dublettenfund akzeptiert noch automatisch in eine andere fachliche Entscheidung umgeschrieben.

Der technische Agent erhält die freigegebene Momentaufnahme, vorhandene Bindungen und einen sicheren Index der aktuellen TypeScript-Dateien unter `src/portal`. Er kann bestehende Bindungsrevisionen wählen oder neue deklarative Rezepte erzeugen. Der Executor kennt allgemeine UI-Aktionen wie Eingabe, Auswahl, Klick und Prüfung. Er enthält keinen Schalter auf bekannte fachliche Block-IDs.

Technische Bindungen gehören zu den elementaren Aktionen und Assertions aus `freigegeben.json.steps`. Zusammengesetzte Workflows und Rollenkontexte werden vom Compiler in diese Schritte aufgelöst. Sie brauchen kein eigenes UI-Rezept. Eine neu vorgeschlagene Bindung für einen solchen Container wird vor der Übernahme abgelehnt; seine fachlichen Parameter und enthaltenen Schritte bleiben erhalten.

Die Anwendung validiert jedes neue Rezept vor der Übernahme. Es darf nur lokale `/portal`-Routen öffnen und bekannte Locatorarten nutzen. Speicheraktionen erfassen die reale HTTP-Antwort ihres UI-Klicks. Damit werden konkrete Kunden-, Betriebs-, Tier-, Vorschlags-, Vertrags- und Dokument-IDs verknüpft. Parent-IDs können zusätzlich gegen die Antwort geprüft werden. Ein gesetztes Fachfeld muss im tatsächlich ausgeführten Rezept gesetzt oder geprüft werden; andernfalls schlägt der kleinste Block sichtbar fehl.

Eine Assertion kann über `proof` ihr bestandenes boolesches Ergebnis und den tatsächlich gelesenen UI-Text ausgeben. Diese Ergebniswerte entstehen erst nach erfolgreicher Browserprüfung.

`expectEnabled` prüft, dass das gewählte Bedienelement sichtbar und aktiviert ist. `expectDisabled` prüft, dass es sichtbar und gesperrt ist. Beide Aktionen verwenden einen `locatorKey` der Bindung und können nach erfolgreicher Prüfung `proof` ausgeben. Eine reine `expectVisible`-Prüfung belegt keine Berechtigung: Ein Formular kann für eine Rolle sichtbar sein, obwohl seine Eingaben gesperrt sind. Rollenprüfungen müssen daher den erwarteten Bedienzustand prüfen. Bei einem Speicherklick müssen zusätzlich die fachlichen Voraussetzungen erfüllt sein, etwa eine eingegebene Begründung; ein wegen fehlender Pflichtangaben gesperrter Button belegt keine fehlende Rollenberechtigung.

Ein automatisch geöffnetes Formular ist ein expliziter UI-Zustand. `unlessVisible` darf einen reinen Öffnungsklick nur überspringen, wenn das benannte Formularfeld tatsächlich sichtbar ist. Es überspringt keine fachliche Speicheraktion und schluckt keine fehlgeschlagenen Selektoren. Der Wert ist ein `key` aus den `locators` derselben Bindung. Die Bedingung ist bei `fill`, `select`, `check`, Assertions und jedem Klick mit `capture` ungültig. Fehlermeldungen nennen Bindung, Revision, `recipe`-Index, Aktionsart und den konkreten Grund. Die einzige Korrekturrunde erhält die Fehler aller neuen Bindungen zusammen sowie die vorherige vollständige Antwort. Im Kontext stehen zusätzlich `rezept-validierung.ts` und `rezept-ausfuehrung.ts` mit den tatsächlichen Regeln; bereits vorhandene Bindungen liefern vollständige Beispiele. Ein weiterhin ungültiger Plan wird weder übernommen noch ausgeführt.

Für die Browserausführung werden genau die vom Agenten geprüften Bindungsrevisionen eingefroren. Neue Bindungen werden als vollständiges Set geprüft und atomar gespeichert. Hat der Mensch während der Agentenarbeit den Fachablauf geändert, wird das Ergebnis als veraltet behandelt. Die technische Runde kann keine neue fachliche Freigabe erteilen.

Ein Dublettenfund führt zur sichtbaren Entscheidung. Ein gleichwertiger vorhandener Block kann übernommen werden; daraus entsteht eine neue fachliche Revision zur erneuten Prüfung. Eine notwendige Erweiterung bleibt als konkrete Fachaufgabe sichtbar. Die Anwendung ersetzt dabei keine Fachsemantik still im Hintergrund.

Nach der Verdrahtung öffnet Chromium das Versicherungsportal und führt den Ablauf tatsächlich aus. Der Lauf speichert jeden elementaren Pfad, Screenshots, einen Playwright-Trace, die konkrete Bindungsrevision und die erzeugten Objekt-IDs. `generated.spec.ts` importiert den zentralen generischen Executor und verwendet die eingefrorenen Daten aus `compiled.json`. Selektoren werden nicht in jeden generierten Test kopiert.

## Wiederverwendung und Reparatur

Erst nach einem erfolgreichen Browserlauf erhält ein weiterer Agent den geprüften Ablauf und die Laufnachweise. Er schlägt passende Kompositionen und veränderliche Parameter vor. Der Mensch kann Namen und Parameter bearbeiten, Vorschläge annehmen oder verwerfen. Die Annahme prüft nochmals den exakt erfolgreich getesteten Fachstand. Verschachtelte Vorschläge benennen ihre übergeordnete Ebene mit `parentPath`; angenommen wird jeweils ein Vorschlag. Eine fehlgeschlagene Wiederverwendungsprüfung kann auf dem bereits bestandenen Lauf erneut gestartet werden, ohne erneut Versicherungsobjekte anzulegen.

Wenn ein Portalbutton umbenannt wird, scheitert der kleinste technische Block. Der Einflussbericht verfolgt die Bindung durch direkte Verwendungen und enthaltene Workflows bis zu allen betroffenen Testfällen. Ein Reparaturauftrag enthält den fehlgeschlagenen Lauf, die alte Bindung und die aktuellen Portalquellen. Der Agent liefert eine neue Revision derselben Bindung. Alte Läufe behalten ihre ursprünglichen Selektoren und Nachweise.

## Konfiguration und Betrieb

| Variable | Bedeutung |
| --- | --- |
| `FOLIO_CODEX_EXECUTABLE` | Pfad zur Codex CLI; ansonsten `/opt/homebrew/bin/codex`, falls vorhanden, sonst `codex` aus PATH |
| `FOLIO_CLAUDE_EXECUTABLE` | Pfad zu Claude Code; ansonsten `/opt/homebrew/bin/claude`, falls vorhanden, sonst `claude` aus PATH |
| `FOLIO_CODEX_TIMEOUT_MS` | Gemeinsames Zeitlimit pro CLI-Aufruf beider Provider, standardmäßig 300000 ms, höchstens 1800000 ms |
| `FOLIO_AGENT_ARTIFACTS_ROOT` | Agentennachweise, standardmäßig `.local/testing/agents` |
| `FOLIO_TESTING_RUN_ROOT` | Browsernachweise, standardmäßig `.local/testing/runs` |
| `FOLIO_APP_URL` | Adresse des Portals, standardmäßig `http://127.0.0.1:5173` |
| `FOLIO_AUTO_REUSE=0` | Deaktiviert ausschließlich die automatische KI-Nachprüfung erfolgreicher Browserläufe, beispielsweise auf einem isolierten Testserver. Es wird kein KI-Ergebnis simuliert. Standardmäßig ist sie aktiv. |

Der Adapter begrenzt die CLI-Aufrufe der Anwendung auf zwei gleichzeitige Kindprozesse. Weitere Aufträge warten. Ein Abbruch beendet die zugehörige Prozessgruppe, auch bei einer Warteposition oder direkt vor dem Start. Ein Zeitlimit beendet einen hängenden Aufruf. Beim Neustart werden unterbrochene Aufträge als abgebrochen markiert; anhand gespeicherter PID und des exakten Auftragsverzeichnisses werden noch laufende zugehörige CLI-Prozesse erkannt und beendet. Ein altes `result.json` wird vor jedem erneuten Aufruf entfernt und kann keinen neuen Erfolg vortäuschen.

`npm run dev:stable` hält den Backendprozess während einer Vorführung stabil. Ein laufender Agenten- oder Browserauftrag sollte vor einer bewussten Backendänderung beendet werden. Der Frontendcode aktualisiert sich weiterhin über Vite.

## Prüfen

`server/testing/agents/duplicate-schema.test.ts` prüft die unabhängigen ID-/Versionsbeschränkungen, unveränderte freie Begründungsfelder und die Isolation mehrerer Schemaaufrufe. Die Tests verwenden fiktive Definitionen.

`server/testing/agents/pipeline.test.ts` prüft den Prozessvertrag mit einer ausdrücklich als Testfixture benannten lokalen CLI. Das sind keine Belege für Modellqualität oder echten KI-Erfolg. Es prüft Argumente, globale Parallelität, Abbruch, veraltete Antworten, technische Eingabeabdeckung und eine Szenarioänderung während der Agentenarbeit.

`e2e/testing-runtime.spec.ts` prüft echte Browserläufe mit getrennten Testdaten, eine neu definierte freie Assertion sowie einen absichtlich veralteten Button und die zentrale Reparatur. Echte Luna-/Sol-Aufrufe werden separat im lokalen System durchgeführt; ihre Prompts, Modelle, Schemas und Ergebnisse bleiben als Agentenartefakte erhalten.

`server/testing/agents/providers.test.ts` prüft beide CLI-Adapter mit ausdrücklich künstlichen Prozessantworten, gespeicherte Modellprofile, Argumente, Fehlerergebnisse und unveränderliche Auftragskonfigurationen. `server/testing/agents/flow-edit.test.ts` prüft Vorschau, verschachtelte Änderungen, Verwerfen, Übernahme und veraltete Revisionen. Die Browserprüfungen der KI-Oberfläche verwenden vorbereitete Agentenantworten; sie behaupten keinen echten Modelllauf.

`server/testing/agents/exploration.test.ts` verwendet eine künstliche CLI, die den Kontext ausschließlich aus der Modellanfrage liest, und einen echten isolierten Portalbrowser. Die Tests prüfen Beobachtungen, Kundenanlage, Rollenwechsel, ungültige Belege, Kontextgrenzen und Abbruch. `business-lifecycle.test.ts` prüft die sofortige Speicherung, Wiederaufnahme, Revisionsschutz und die Trennung zwischen Browserergebnis und optionaler Analyse. `e2e/testing-workspace.spec.ts` prüft den geführten Arbeitsbereich mit vorbereiteten Agentenantworten und echten lokalen Speicheraktionen.

Am 7. September 2026 wurde die Erkundung zusätzlich mit einem echten Luna-Aufruf und einem vollständig leeren synthetischen Katalog geprüft. Das Modell navigierte selbst zum Neukundenformular und belegte die Feldbezeichnung „Name des Kunden“ mit vier Browserbeobachtungen. Es erzeugte einen Wissensbeleg ohne offene Fragen und speicherte keine Portalobjekte. Dieser Nachweis gilt für die konkrete Erkundungsaufgabe, nicht für beliebige fachliche Anforderungen. Die lokalen Protokolle und Screenshots werden nicht veröffentlicht.

Am 8. September 2026 wurde der Rollenvergleich mit Luna und ausschließlich dem öffentlichen Beispielkatalog geprüft. Sechs Browserbeobachtungen belegten am selben Vorgang, dass Vermittler und Sachbearbeiter eine noch offene Direktionsanfrage nicht entscheiden konnten und die Direktion sie anschließend mit Begründung erfolgreich freigab. Die Abnahme prüfte ausgewählte Rollen, den offenen Ausgangszustand, die gesperrte Schaltfläche und die tatsächliche Speicheraktion unabhängig von der Abschlussmeldung des Modells. Die Prüffragen waren vollständig beantwortet; es blieben keine offenen Fragen. Der private Ausgangsauftrag wurde für diese Probe weder übertragen noch verändert.

Bei der lokalen Abnahme am 7. September 2026 wurde Claude Code zusätzlich mit einem künstlichen Prompt für `{ "ok": true }` und ohne Kontextdateien aufgerufen. Die CLI akzeptierte die Argumente, meldete aber „Not logged in“. Eine erfolgreiche strukturierte Modellantwort von Claude ist damit auf diesem Rechner noch nicht nachgewiesen. Die Anwendung zeigt diesen Anmeldefehler an. Eine Anmeldung in der eigenen Claude CLI ist vor dem ersten Auftrag erforderlich.

Konkrete lokale Abnahmebelege und ihre Grenzen stehen in [Pipeline-Nachweise](pipeline-nachweise.md).
