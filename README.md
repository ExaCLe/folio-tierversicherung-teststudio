# Folio: Tierversicherung und Teststudio

Der Prototyp verbindet zwei getrennte Anwendungen. Das blaue Versicherungsportal "Land & Tier" bildet die fachliche Bearbeitung von Tierversicherungen ab. Im grünen Teststudio werden diese Abläufe mit echten Scratch-Blöcken zusammengestellt, fachlich geprüft und durch Playwright im Portal ausgeführt. Beide Oberflächen sind vollständig Deutsch und besitzen ihre eigene Navigation.

## Schnellstart

Voraussetzungen sind Git, Node.js ab 20.19 und npm. Die Paketversionen stehen in `package-lock.json`.

```sh
git clone https://github.com/ExaCLe/folio-tierversicherung-teststudio.git
cd folio-tierversicherung-teststudio
npm ci
npx playwright install chromium
npm run dev:stable
```

Das Terminal geöffnet lassen und eine der Anwendungen im Browser aufrufen:

- [Versicherungsportal](http://127.0.0.1:5173/portal) für Kunden, Betriebe, Tiere, Vorschläge und Policen
- [Teststudio](http://127.0.0.1:5173/testing) für Scratch-Testfälle und Browserläufe

Vite läuft auf Port 5173, die API auf Port 3001. Beide Ports müssen frei sein. Der Aufruf `/` führt zum Teststudio. Mit `Ctrl+C` endet der gemeinsame Start.

Beim ersten API-Start legt die Anwendung `.local/folio.json` mit fiktiven Beispieldaten an. Spätere Starts ergänzen fehlende Beispieldaten und erhalten vorhandene Vorgänge. Lokale Daten, Agentenprotokolle und Browsernachweise unter `.local/` werden von Git ignoriert und entstehen erst beim Start beziehungsweise bei ihrer Nutzung.

Portalbearbeitung und die Testbefehle funktionieren ohne KI-Anmeldung. Für die Agentenfunktionen ist die [Einrichtung von Codex oder Claude Code](#lokale-ki-anbindung) nötig. Zusätzliche Agentenserver werden nicht gestartet; die API ruft die lokale CLI auf.

Der [deutsche Demoguide](docs/demo-walkthrough.md) führt durch Portalbearbeitung, Scratch-Blöcke, fachliche Freigabe und Browsernachweise.

## Eine vorhandene Installation aktualisieren

Den laufenden Entwicklungsserver mit `Ctrl+C` beenden und im Projektverzeichnis ausführen:

```sh
git pull --ff-only
npm ci
npx playwright install chromium
npm run dev:stable
```

Danach die Browserseite neu laden. Die vorhandene Datei `.local/folio.json` bleibt erhalten, einschließlich eigener Testfälle und KI-Einstellungen. Änderungen am API-Code werden bei `dev:stable` erst durch den Neustart geladen.

## Entwicklung und getrennte Prozesse

`npm run dev:stable` startet Frontend und API gemeinsam. Das Frontend aktualisiert sich bei Änderungen; API-Änderungen werden nach einem Neustart geladen. Für die Entwicklung mit automatischem API-Neustart:

```sh
npm run dev
```

Die Teile lassen sich auch einzeln starten. Frontend und API laufen dann in zwei eigenen Terminals im Projektverzeichnis; das Frontend benötigt die API für Daten und Aktionen.

| Teil | Befehl / Einstieg | Adresse oder Wirkung |
| --- | --- | --- |
| Frontend | `npm run dev:client` | Portal und Teststudio auf `http://127.0.0.1:5173` |
| API mit automatischem Neustart | `npm run dev:server` | API auf `http://127.0.0.1:3001` |
| API ohne automatischen Neustart | `npm start` | API auf Port 3001; Änderungen werden beim nächsten Start geladen |
| Frontend und API zusammen | `npm run dev` | Beide Prozesse in einem Terminal, mit automatischem API-Neustart |
| Gemeinsamer Start für Vorführungen | `npm run dev:stable` | Beide Prozesse in einem Terminal, ohne automatischen API-Neustart |
| Unit- und API-Tests | `npm test` | Prüft Domänenmodell, Compiler und Agentenvertrag |
| Browsertests | `npm run test:e2e` | Startet eigene Testserver auf Port 3002 und 5174 sowie Chromium |
| KI-Agenten | Unter „Einstellungen“ Modelle konfigurieren, dann im Teststudio ein Modell wählen und einen Auftrag starten | Die API startet Codex oder Claude Code; kein zusätzlicher Agentenserver nötig |

Die API-Startbefehle sind Alternativen: Für dieselbe Datendatei und Port 3001 darf nur ein API-Prozess laufen. Die technische Umsetzung und weitere Agentenaufträge werden ebenfalls aus dem Teststudio gestartet. Die Schritte stehen im [Demoguide](docs/demo-walkthrough.md).

Für Vorführungen eignet sich `npm run dev:stable`, weil der API-Prozess bei Quelltextänderungen weiterläuft. Ein laufender Browser- oder Agentenauftrag sollte beendet sein, bevor der API-Prozess neu gestartet wird.

Die Installation lädt npm-Pakete und Chromium. Versicherungsportal, Speicherung und Browserausführung laufen lokal. Die Agentenfunktionen des Teststudios rufen Modelle über die ausgewählte lokale CLI auf und benötigen dafür eine bestehende Anmeldung und Netzwerkverbindung.

## Einen Versicherungsfall bearbeiten

1. Im Portal die Benutzerrolle „Vermittler“ wählen und „Neuer Versicherungsvorschlag“ öffnen.
2. „Standardkuh laden“ füllt einen Kunden, Hof Lindenkamp in Niedersachsen und die Kuh Alma mit 3.500 EUR Versicherungssumme vor. Die Daten werden einzeln gespeichert: Kunde, Betrieb und Tier.
3. Über die jeweiligen „Weiter“-Knöpfe zum Vorschlag wechseln. Versicherungsbeginn prüfen und „Vorschlag speichern“ wählen.
4. „Angebot berechnen“ ermittelt den Jahresbeitrag. „Antrag einreichen“ prüft die Annahmeregeln.
5. Der Standardfall wird direkt freigegeben. Mit „Vertrag abschließen“ entstehen ein eigener Vertrag, eine Police und deren erste Dokumentfassung.
6. Bei einer Kuh mit 15.000 EUR entsteht eine Direktionsanfrage. Die Rolle „Direktion“ muss eine begründete Entscheidung speichern. Anschließend kann die Vermittlung den freigegebenen Vertrag abschließen.
7. In der Rolle „Sachbearbeiter“ lässt sich die Police begründet erneut ausgeben und ein Druckauftrag für eine bestimmte Dokumentversion erfassen. Der Browserdruck wird nach dem erfassten Druckauftrag freigeschaltet.

Ein Kunde kann mehrere Betriebe besitzen. Die Kundenanschrift und die Betriebsadresse sind unabhängig. Die Bayern-Variante verwendet Bauernhof Sonnleitner, Dorfstraße 12, 87437 Kempten. Sie ändert den Betriebsstandort gegenüber Hof Lindenkamp in Niedersachsen, ohne die Kundenanschrift zu ersetzen.

## Tierarten und Angaben

| Tierart | Erforderliche Angaben | Produkt |
| --- | --- | --- |
| Kuh / Rind | Name, Ohrmarke, Rasse, Geburtsdatum, Nutzung, Versicherungssumme | Tierlebensversicherung |
| Pferd | Name, Chipnummer, Rasse, Geburtsdatum, Nutzung, Gesundheitszustand, Versicherungssumme; Beschreibung bei Vorerkrankung | Tierlebensversicherung |
| Hund | Name, Chipnummer, Rasse, Geburtsdatum, Nutzung, Versicherungssumme | Tierlebensversicherung |
| Schweinebestand | Bestandsname, Anzahl Schweine, Haltungsform, Biosicherheit, gesamte Versicherungssumme | Bestandsversicherung |

Jedes Tier und jeder Bestand gehört genau einem Betrieb. Ein Vorschlag darf ausschließlich passende Tiere dieses Betriebs enthalten. Schweinebestände und Einzeltiere benötigen getrennte Vorschläge. Kunde, Betrieb, Tier, Vorschlag, Direktionsanfrage, Vertrag, Police und Dokument haben jeweils eigene Kennungen.

## Fiktive Annahme- und Beitragsregeln

| Tierart | Direktionsanfrage bei mehr als | Jahresbeitrag |
| --- | --- | --- |
| Kuh / Rind | 10.000 EUR je Tier | 3,5 % der Summe |
| Pferd | 50.000 EUR je Tier | 4 % der Summe |
| Hund | 10.000 EUR je Tier | 5 % der Summe |
| Schweinebestand | 500.000 EUR je Bestand | 1,8 % der Summe |

Der Grenzwert selbst löst keine Anfrage aus. Eine Vorerkrankung beim Pferd und ungeklärte Biosicherheit beim Schweinebestand erfordern ebenfalls eine Direktionsentscheidung. Das Bundesland verändert diese Regeln nicht. Die Beiträge der versicherten Positionen werden addiert; je Vorschlag gilt ein Mindestjahresbeitrag von 60 EUR. Die Laufzeit beträgt zwölf Monate.

Die Rollenprüfung erfolgt auch in der API. Nur die Direktion entscheidet über offene Direktionsanfragen. Ein abgelehnter oder noch nicht freigegebener Antrag kann nicht abgeschlossen werden. Nur Sachbearbeiter geben bestehende Policen erneut aus und erfassen Druckaufträge. Die Rollenwahl ist eine lokale Simulation und ersetzt keine Anmeldung für ein produktives Versicherungssystem.

Ein Druckauftrag enthält die konkrete Dokumentkennung und deren SHA-256. Frühere Dokumentfassungen bleiben erhalten. Er belegt die Druckanforderung, keinen physischen Ausdruck. „Land & Tier“, alle Vertragsdaten, Beiträge und Annahmeregeln sind fiktiv.

## Im Teststudio arbeiten

Das Studio verwendet `scratch-blocks` mit dem Scratch-Renderer. Verbundene Blöcke beschreiben die ausführbare Reihenfolge. Frei abgelegte Blöcke und ihre Bildschirmpositionen werden als Layout gespeichert. Sie ändern die fachliche Reihenfolge nicht.

Eine Definition beschreibt die fachliche Bedeutung und die Eingaben eines Blocks. Eine Instanz verwendet diese Definition in einem Testfall. Eine separate technische Bindung legt die konkreten Browseraktionen fest. Wiederverwendbare Abläufe bestehen aus bestehenden Blöcken und können Parameter nach außen anbieten, etwa Versicherungssumme oder Bundesland.

Agenten erzeugen prüfbare Entwürfe. Fachliche Prüfung, menschliche Freigabe und technische Verdrahtung bleiben sichtbare Schritte. Ein gespeicherter Testfall wird gegen seine Definitionen, Referenzen, Rollen und Freigaben geprüft. Der Browserlauf verwendet den festgehaltenen Stand und bindet Rückgaben an die tatsächlichen im Portal erzeugten Kennungen. Ein erfolgreicher Compilerlauf ist noch kein bestandener Browserlauf.

Prüfhinweise nennen den betroffenen Schritt und das Eingabefeld. Bei einer falschen Verknüpfung erklären sie, welches Ergebnis benötigt wird, etwa ein Versicherungsvorschlag, und welcher frühere Block das ausgewählte Ergebnis erzeugt. Über den Hinweis lässt sich die betreffende Stelle zum Bearbeiten öffnen.

Wenn eine Blockdefinition korrigiert wurde, zeigt der Inspector die verwendete Blockversion. Dort lässt sich eine bereits veröffentlichte neue Version für diese Verwendung übernehmen. Eine Bearbeitung direkt am Block aktualisiert diese Verwendung; eine Änderung in der Bibliothek veröffentlicht zunächst nur eine neue Version. Andere Testfälle und frühere Laufnachweise behalten ihren Stand.

Bei einem korrigierten Eingabefeld prüft das Studio dessen aktuelle Definition gegen das tatsächlich ausgewählte Ergebnis. Eine alte gespeicherte Typangabe allein macht eine passende Auswahl nicht ungültig. Ist weiterhin ein Vertrag ausgewählt, obwohl nun ein Versicherungsvorschlag benötigt wird, bleibt der Hinweis bestehen, bis die passende Quelle gewählt wurde.

Die [Blockmethode](docs/block-method.md) erklärt die fachlichen Schritte. Das [Speichermodell](docs/storage-model.md) beschreibt Versionen, Beziehungen und den daraus abgeleiteten Graphen.

## Einen bestehenden Ablauf mit KI ändern

1. Unter „Testfälle“ den gewünschten Testfall öffnen. Das funktioniert auch nach einer abgeschlossenen technischen Umsetzung.
2. Im Feld „Anweisung für den gesamten Ablauf“ beispielsweise schreiben: „Füge nach der Antragseinreichung eine Prüfung ein, dass ein Vermittler die Direktionsentscheidung nicht bearbeiten darf. Behalte alle anderen Schritte bei.“
3. „Änderungsvorschlag erstellen“ wählen. Bei ungespeicherten Änderungen speichert „Speichern und Vorschlag erstellen“ zuerst den bearbeiteten Stand.
4. Den vorgeschlagenen Ablauf und die Änderungen prüfen. Erst die Übernahme ändert den gespeicherten Testfall. Ein Vorschlag kann auch verworfen werden.
5. Die neue Fassung fachlich prüfen und freigeben. Anschließend die technische Umsetzung und den Browserlauf erneut starten.

Der Auftrag bezieht sich auf eine bestimmte Revision. Zwischenzeitliche Änderungen verhindern, dass ein älterer Vorschlag den neueren Ablauf überschreibt. Vorhandene Testnachweise bleiben ihrer ursprünglichen Fassung zugeordnet.

## Lokale KI-Anbindung

Das Teststudio unterstützt Codex und Claude Code. Die CLI des gewünschten Providers muss auf demselben Rechner wie die API installiert und angemeldet sein. Die Anwendung verwendet die bestehende Anmeldung; sie liest oder kopiert keine Anmeldedateien.

Für Codex die [offizielle Installationsanleitung](https://learn.chatgpt.com/docs/codex/cli) verwenden und anschließend prüfen:

```sh
codex --version
codex login
codex login status
```

Für Claude Code die [offizielle CLI-Dokumentation](https://code.claude.com/docs/en/cli-reference) verwenden. `claude --version` prüft die Installation; mit `claude` lässt sich die interaktive Einrichtung und Anmeldung durchführen.

Unter **Einstellungen** im Teststudio:

1. „Modell hinzufügen“ wählen, einen Anzeigenamen vergeben und den Provider auswählen.
2. Unter „Modellname / Slug“ den Modellnamen der CLI eintragen, beispielsweise `sonnet` für Claude Code oder den gewünschten Codex-Modellnamen. Die vorhandenen Profile Luna und Sol bleiben vorkonfiguriert.
3. Zusätzliche Argumente für einen Provider oder ein einzelnes Modell eintragen. Für Claude Code ist beispielsweise `--effort high` möglich. Hier stehen nur die Argumente, nicht der vollständige Befehl `claude --effort high`.
4. Das Standardmodell auswählen und „Einstellungen speichern“ drücken. Anschließend stehen die Modelle bei den KI-Aufträgen zur Auswahl.

Das optionale Feld „CLI-Programm“ enthält nur den Programmnamen oder Pfad. Leer verwendet es die lokale Standardkonfiguration. Die Modellverfügbarkeit hängt vom jeweiligen Konto ab. Ein nicht verfügbares Modell ergibt einen sichtbaren Fehler und wird nicht still ersetzt.

Die API startet `codex exec` beziehungsweise `claude --print` mit einem strukturierten Ausgabeschema. Nutzertext wird über die Standardeingabe übergeben. Ein zusätzliches Terminal mit einem laufenden Agenten ist nicht nötig. Provider, Modell und Argumente werden für jeden Auftrag festgehalten; spätere Einstellungsänderungen gelten für neue Aufträge.

Details zu unterstützten Argumenten, Grenzen und Nachweisen stehen in [KI-Anbindung](docs/codex-anbindung.md). Die Auftragsartefakte liegen unter `.local/testing/agents/` und gehören nicht ins öffentliche Repository.

## Prüfen und bauen

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run check` führt Unit-Tests, TypeScript-Prüfung, Produktionsbuild und die aktive Browser-Suite aus. Einige API-Tests öffnen kurzzeitig einen lokalen Port. Playwright verwendet eine eigene API auf Port 3002 und eine eigene Oberfläche auf Port 5174 mit separater JSON-Datei je Testaufruf. Diese beiden Ports müssen frei sein. Die Demo-Datenbank wird dabei nicht zurückgesetzt.

Die aktive Browser-Suite wählt ausdrücklich `e2e/agriculture-*.spec.ts` und `e2e/testing-*.spec.ts`. Die Portaltests prüfen echte Eingaben und Klicks für Direktabschluss, Direktionsfreigabe, Ablehnung, Grenzwert, alle Tierarten, mehrere Betriebe sowie Ausgabe und Drucknachweis. Die Versicherungs-Unit-Tests prüfen zusätzlich unzulässige Feldwerte, fremde Kennungen, manipulierte Angebots- und Dokumentdaten sowie Speicherung über einen Prozessneustart hinweg.

```sh
npx playwright show-report .local/playwright-report
```

Neue Teststudioläufe speichern ihren Stand, Browsernachweise und generierten Test unter `.local/testing/runs/`. Agentenläufe und Browserläufe haben getrennte Nachweise. Modellaufrufe sind kein Bestandteil eines gewöhnlichen Versicherungsportal-Tests.

Den Trace eines Studiolaufs öffnen oder dessen generierten Test wiederholen:

```sh
npx playwright show-trace .local/testing/runs/LAUF_ID/trace.zip
FOLIO_REPLAY=1 npx playwright test .local/testing/runs/LAUF_ID/generated.spec.ts
```

`LAUF_ID` durch die Kennung eines vorhandenen Laufs ersetzen. Die Wiederholung verwendet die im kompilierten Stand gespeicherten Bindungen und erzeugt neue fiktive Portalobjekte. Der ursprüngliche Lauf und seine Nachweise bleiben erhalten.

Ein Produktionsbuild lässt sich über einen Port starten:

```sh
npm run build
FOLIO_APP_URL=http://127.0.0.1:3001 npm start
```

Danach sind [Portal](http://127.0.0.1:3001/portal) und [Teststudio](http://127.0.0.1:3001/testing) über Port 3001 erreichbar. `FOLIO_APP_URL` gibt dem Browser-Runner die Adresse der Oberfläche vor.

## Aufbau und Speicherung

| Verzeichnis | Aufgabe |
| --- | --- |
| `shared/agriculture.ts` | Gemeinsame Fachtypen, Rollen, Regeln und Beispieldaten der Tierversicherung |
| `server/agriculture/` | Validierung, Annahme, Beiträge, Entscheidungen, Dokumentversionen und Druckaudit |
| `src/portal/` | Eigenständiges blaues Portal mit Erfassung, Vorgängen und Dokumentansicht |
| `shared/testing.ts` | Definitionen, Instanzen, Bindungen, Freigaben und Läufe des Teststudios |
| `server/testing/` | Katalog, Speicherung, Compiler, Graph, Agenten und Browser-Runner |
| `src/testing/` | Eigenständiges grünes Teststudio mit Scratch-Arbeitsfläche |
| `e2e/helpers/agriculture-driver.ts` | Generische Ausführung der gespeicherten Portalbindungen |
| `e2e/agriculture-*.spec.ts`, `e2e/testing-*.spec.ts` | Aktive Browser- und API-Abnahme |
| `docs/` | Fachmethode, Schnittstellen, Speicherung und KI-Anbindung |
| `.local/` | Lokale Daten, Testberichte sowie Agenten- und Browsernachweise |

Die gemeinsame lokale Datei ist `.local/folio.json`. Neue Versicherungsobjekte liegen ausschließlich in `agriculture.*`-Kollektionen. `FOLIO_DATA_FILE` wählt bei Bedarf eine andere Datei. Ein Speichervorgang erhält andere Kollektionen und schreibt über eine temporäre Datei mit anschließendem atomarem Umbenennen. Pro Datendatei soll ein Serverprozess laufen. Der Prototyp enthält keine verteilte Produktionsdatenbank.

Der vollständige [Portalvertrag](docs/agriculture-api.md) dokumentiert `/api/agriculture`, Rollen, Statuswechsel und zugängliche Feldbeschriftungen. Das Teststudio verwendet `/api/testing`. Die Oberflächen teilen keine Sidebar.

Die aktuellen Studio-Endpunkte stehen im [Teststudiovertrag](docs/testing-api.md).

## Historischer Vorgänger

Die Dateien in `src/insurance/`, `server/insurance/`, `src/studio/` und `server/studio/` sowie die alten Property-Kataloge und deren Daten bleiben als historischer Vorgänger erhalten. Die neue aktive Anwendung zeigt die frühere englische Sachversicherung nicht mehr. Frühere Policen, Szenarien, Traces und Dateien unter `.local/runs/` werden nicht gelöscht oder in Tierversicherungen umgedeutet.

Die fünf alten E2E-Dateien mit den Präfixen `insurance-` und `studio-` prüfen die abgelöste Oberfläche. Sie gehören nicht zur aktiven Suite und werden auch nicht als übersprungene Erfolge gezählt. Ihre früheren 18 bestandenen Tests sind kein Nachweis für den neuen Umbau. Alte Domain- und Compiler-Unit-Tests bleiben zur Prüfung der erhaltenen Backends bestehen.

Die alten [Insurance-](docs/insurance-api.md) und [Studio-API-Dokumente](docs/studio-api.md) sind ausdrücklich historisch gekennzeichnet. Die frühere Demoanleitung liegt im [Archiv](docs/archive/property-demo-walkthrough.md).
