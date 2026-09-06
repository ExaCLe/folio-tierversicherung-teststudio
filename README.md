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

Portalbearbeitung und die Testbefehle funktionieren ohne Codex-Anmeldung. Für die Agentenfunktionen mit Luna oder Sol ist die [optionale Codex-Einrichtung](#lokale-codex-anbindung) nötig. Zusätzliche Agentenserver werden nicht gestartet; die API ruft die lokale CLI auf.

Der [deutsche Demoguide](docs/demo-walkthrough.md) führt durch Portalbearbeitung, Scratch-Blöcke, fachliche Freigabe und Browsernachweise.

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
| Codex-Agenten | Im Teststudio Luna oder Sol wählen und „Fachlichen Entwurf erstellen“ auslösen | Die laufende API startet `codex exec`; kein zusätzlicher Agentenserver nötig |

Die API-Startbefehle sind Alternativen: Für dieselbe Datendatei und Port 3001 darf nur ein API-Prozess laufen. Die technische Umsetzung und weitere Agentenaufträge werden ebenfalls aus dem Teststudio gestartet. Die Schritte stehen im [Demoguide](docs/demo-walkthrough.md).

Für Vorführungen eignet sich `npm run dev:stable`, weil der API-Prozess bei Quelltextänderungen weiterläuft. Ein laufender Browser- oder Agentenauftrag sollte beendet sein, bevor der API-Prozess neu gestartet wird.

Die Installation lädt npm-Pakete und Chromium. Versicherungsportal, Speicherung und Browserausführung laufen lokal. Die Agentenfunktionen des Teststudios rufen Modelle über die lokale Codex-CLI auf und benötigen dafür eine bestehende Anmeldung und Netzwerkverbindung.

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

Die [Blockmethode](docs/block-method.md) erklärt die fachlichen Schritte. Das [Speichermodell](docs/storage-model.md) beschreibt Versionen, Beziehungen und den daraus abgeleiteten Graphen.

## Lokale Codex-Anbindung

Die Codex-CLI wird nur für Agentenaufträge benötigt. Sie ist keine npm-Abhängigkeit dieses Projekts. Die [offizielle Installationsanleitung](https://learn.chatgpt.com/docs/codex/cli) beschreibt die Einrichtung für das eigene Betriebssystem. Anschließend die CLI prüfen und anmelden:

```sh
codex --version
codex login
codex login status
```

`codex login` öffnet die Anmeldung im Browser. Eine vorhandene Anmeldung kann mit `codex login status` geprüft und weiterverwendet werden. Weitere Anmeldeverfahren stehen in der [offiziellen OpenAI-Dokumentation](https://learn.chatgpt.com/docs/auth).

Danach im Teststudio Luna oder Sol wählen und "Fachlichen Entwurf erstellen" auslösen. Die laufende API startet `codex exec` selbst; ein zusätzlicher CLI-Prozess oder Agentenserver muss nicht manuell gestartet werden.

Die Agentenaufrufe verwenden die installierte Codex-CLI und deren lokale Anmeldung. Die Anwendung liest oder kopiert keine Anmeldedateien. Die konfigurierten Modelle sind `gpt-5.6-luna` und `gpt-5.6-sol`. Verfügbarkeit und Laufzeit hängen vom verwendeten Konto und der Verbindung ab. Wenn ein Modell nicht verfügbar ist, zeigt das Teststudio den Fehler des Aufrufs.

Automatisierte Aufträge laufen über `codex exec`. Der Prompt wird über die Standardeingabe übergeben, strukturierte Ergebnisse werden mit einem Ausgabeschema gelesen. `-m` wählt das Modell, `-p` bezeichnet ein Profil. Die CLI kann mit `codex exec --help` geprüft werden. Der nicht interaktive Aufruf ist auch in der [offiziellen OpenAI-Dokumentation](https://learn.chatgpt.com/docs/non-interactive-mode) beschrieben.

Die vollständige Konfiguration, Zustände und Nachweise stehen in [Codex-Anbindung](docs/codex-anbindung.md). `FOLIO_CODEX_EXECUTABLE` kann einen abweichenden CLI-Pfad setzen, `FOLIO_CODEX_TIMEOUT_MS` das Zeitlimit eines Aufrufs. Agentenprompts, übergebener Kontext und Ergebnisse liegen getrennt von den Versicherungsdaten unter `.local/testing/agents/`.

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
| `docs/` | Fachmethode, Schnittstellen, Speicherung und Codex-Anbindung |
| `.local/` | Lokale Daten, Testberichte sowie Agenten- und Browsernachweise |

Die gemeinsame lokale Datei ist `.local/folio.json`. Neue Versicherungsobjekte liegen ausschließlich in `agriculture.*`-Kollektionen. `FOLIO_DATA_FILE` wählt bei Bedarf eine andere Datei. Ein Speichervorgang erhält andere Kollektionen und schreibt über eine temporäre Datei mit anschließendem atomarem Umbenennen. Pro Datendatei soll ein Serverprozess laufen. Der Prototyp enthält keine verteilte Produktionsdatenbank.

Der vollständige [Portalvertrag](docs/agriculture-api.md) dokumentiert `/api/agriculture`, Rollen, Statuswechsel und zugängliche Feldbeschriftungen. Das Teststudio verwendet `/api/testing`. Die Oberflächen teilen keine Sidebar.

Die aktuellen Studio-Endpunkte stehen im [Teststudiovertrag](docs/testing-api.md).

## Historischer Vorgänger

Die Dateien in `src/insurance/`, `server/insurance/`, `src/studio/` und `server/studio/` sowie die alten Property-Kataloge und deren Daten bleiben als historischer Vorgänger erhalten. Die neue aktive Anwendung zeigt die frühere englische Sachversicherung nicht mehr. Frühere Policen, Szenarien, Traces und Dateien unter `.local/runs/` werden nicht gelöscht oder in Tierversicherungen umgedeutet.

Die fünf alten E2E-Dateien mit den Präfixen `insurance-` und `studio-` prüfen die abgelöste Oberfläche. Sie gehören nicht zur aktiven Suite und werden auch nicht als übersprungene Erfolge gezählt. Ihre früheren 18 bestandenen Tests sind kein Nachweis für den neuen Umbau. Alte Domain- und Compiler-Unit-Tests bleiben zur Prüfung der erhaltenen Backends bestehen.

Die alten [Insurance-](docs/insurance-api.md) und [Studio-API-Dokumente](docs/studio-api.md) sind ausdrücklich historisch gekennzeichnet. Die frühere Demoanleitung liegt im [Archiv](docs/archive/property-demo-walkthrough.md).
