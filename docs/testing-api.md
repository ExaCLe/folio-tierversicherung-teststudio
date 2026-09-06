# Testwerkstatt: fachlicher Datenvertrag

Dieser Vertrag beschreibt das fachliche Modell hinter `/api/testing`. Die HTTP-Routen, Agentenaufträge und Browserausführung werden in `server/testing/router.ts` zusammengeführt. Die verbindlichen Datentypen stehen in `shared/testing.ts`.

## Modell- und Repositoryfunktionen

| Funktion | Eingaben und Ergebnis |
| --- | --- |
| `getTestingCatalog()` | Vereint Quellen und gespeicherte Definitions-, Wissens- und Bindungsrevisionen. |
| `listTestingScenarios()` | Liefert die aktuelle Revision jedes Testfalls. |
| `getTestingScenario(id)` | Liefert einen Testfall oder einen Fehler mit Status 404. |
| `saveTestingScenario(scenario, expectedRevision)` | Speichert eine neue Revision. Ein neuer Testfall verwendet `expectedRevision: 0`. Veraltete Schreibversuche ergeben 409. |
| `approveTestingScenario(id, revision, actor, comment?)` | Validiert den fachlichen Entwurf und speichert seinen Fingerprint. Fehlende technische Bindungen verhindern die Fachfreigabe noch nicht. |
| `getTestingApproval(id)` | Liefert die neueste gespeicherte Freigabe. Der Compiler prüft ihre Gültigkeit. |
| `saveTestingDefinition(definition)` | Speichert eine unveränderliche semantische Version und pflegt Wissensrückverweise. |
| `saveTestingKnowledge(document)` | Speichert eine unveränderliche Wissensrevision. |
| `saveTestingBinding(binding)` | Speichert eine unveränderliche technische Revision. |
| `getTestingLayout(id)` / `saveTestingLayout(layout)` | Lesen und Schreiben des fachlich unabhängigen Editorzustands. |
| `listTestingRuns()` / `getTestingRun(id)` / `saveTestingRun(run)` | Lesen und Fortschreiben der Laufdatensätze. Ein Lauf besitzt seinen eingefrorenen Fach- und Technikstand. |

Fehler des Repositorys besitzen `status`, `code` und einen deutschen `message`-Text. Ein HTTP-Adapter soll diese Informationen erhalten.

## Fachlicher KI-Entwurf

`TestingBusinessDraft` enthält Titel, Erwartung, Blockliste, Wissensverweise, neue Definitionen, neue Wissensdokumente, Erklärung, Annahmen und offene Fragen. Neue elementare Definitionen dürfen zunächst ohne `bindingId` existieren. Ihr `operation`-Name ist frei wählbar. Fehlt er, gilt der vollständige `semanticKey` unverändert als technischer Schlüssel.

`previewTestingBusinessDraft(intent, draft, model, catalog?)` prüft den Entwurf gegen einen übergebenen Katalog. Ein tatsächlich leerer Katalog ist zulässig. Das Ergebnis enthält den vorbereiteten Testfall, den ergänzten Katalog, das Kompilat und Dublettenberichte.

`createTestingScenarioFromDraft(intent, draft, model)` prüft neue Fachdefinitionen und Wissensdokumente auf gültige Referenzen und Versionskonflikte und übernimmt alle Datensätze in einem atomaren Schreibvorgang. Ein unvollständiger Fachablauf kann als Entwurf gespeichert werden. Seine Fachfreigabe ist erst nach Behebung der fachlichen Fehler möglich.

Ein Eingabeschema verwendet bekannte Werttypen. Auswahlfelder benötigen Auswahlwerte. Objektfelder können wiederum typisierte `fields` enthalten. `requiredWhen` und `applicableWhen` beschreiben tierartabhängige Pflichtfelder und erlaubte Angaben. Unbekannte Felder werden nicht still verworfen.

## Kompilierung und Fachfreigabe

`compileTestingScenario(scenario, catalog, approval?)` liefert `TestingCompiledScenario` mit:

- `valid`: fachliche Struktur, Werte, Referenzen und Verbindungen sind gültig;
- `executable`: zusätzlich sind alle benötigten Bindungen bereit, alle Eingaben technisch abgedeckt und die Fachfreigabe aktuell;
- `steps`: aufgelöste elementare Aktionen und Prüfungen mit Benutzerrolle, eindeutigen Pfaden und Ergebnisreferenzen;
- `definitions`, `bindings`, `knowledge`: Kopien der verwendeten Versionen;
- `issues`: deutsche Hinweise und Fehler mit Blockpfad und gegebenenfalls betroffenem Feld.

`testingFingerprint(scenario, catalog)` liefert den Hash des fachlichen Stands. Technische Bindungsrevisionen, Editorlayout und reine Wissensrückverweise gehören nicht zur Fachsemantik. Regeln, Pflichtfelder, Definitionskomposition, lokale Abweichungen und Werte gehören dazu.

Eine fehlende technische Bindung erzeugt `BINDING_MISSING` als Warnung und `executable: false`. Ein unbekanntes Eingabefeld erzeugt `INPUT_UNKNOWN` als fachlichen Fehler. Ein fachlich definiertes, aber technisch nicht verwendetes Feld erzeugt `BINDING_INPUT_MISSING` und verhindert die Ausführung.

## Technische Zuordnung

Eine Definition kann eine stabile `bindingId` besitzen. Der Compiler verwendet deren neueste `ready`-Revision. Höhere `draft`- oder `missing`-Revisionen verdrängen eine vorhandene bereite Bindung nicht.

Eine neue Definition ohne `bindingId` wird über `operation ?? semanticKey` und `definitionRefs` angebunden. Mehrere passende unabhängige Bindungs-IDs sind mehrdeutig und müssen in der technischen Prüfung geklärt werden. So kann die technische Phase neue Fähigkeiten verdrahten, ohne den bereits freigegebenen Fachentwurf umzuschreiben.

Die Bindung benennt alle verwendeten `inputKeys`. Ein deklaratives Rezept enthält Portalnavigation, Formularinteraktionen, Klicks und sichtbare Prüfungen. Ein Klick kann eine zugehörige reale Antwort erfassen. `capture.expect` prüft dabei beispielsweise, ob der gespeicherte Betrieb tatsächlich zum erwarteten Kunden gehört. `when` erlaubt bedingte Schritte für optionale tierartspezifische Felder. `unlessVisible` darf einen optionalen Öffnungsklick nur dann überspringen, wenn das erwartete Formular bereits sichtbar ist.

## Wiederverwendung und Dubletten

`findTestingDuplicates(definition, catalog)` vergleicht Bedeutung, Schema einschließlich Standardwerten, Ergebnisschema und Komposition beziehungsweise Vorgang. Unterschiede lokaler Verwendungs-IDs und Ergebnisnamen werden normalisiert. Das Ergebnis nennt Kandidaten mit Übereinstimmungen, Unterschieden und einer begründeten Entscheidung.

`promoteTestingBlocks(request)` übernimmt eine zusammenhängende Auswahl auf einer Ablaufebene als zusammengesetzte Definition. Der Auftrag enthält Testfall-ID, erwartete Revision, ausgewählte Verwendungs-IDs, Namen, Beschreibung und exponierte Parameter. Das optionale `parentPath` bezeichnet einen umgebenden Rollen- oder Workflowblock. Verweise auf Ergebnisse außerhalb der Auswahl und erfasste äußere Parameter werden zu erforderlichen Eingaben.

Exponierte Parameter erhalten konkrete Standardwerte aus dem Elternkontext. Wird ein inneres `name: { "param": "customerName" }` beispielsweise als neuer Parameter `kundenname` veröffentlicht, enthält dessen Default den tatsächlichen Namen des geprüften Vorgangs. Der neue Bibliotheksblock verlangt keinen versteckten Elternparameter mehr. Bei einer Ersetzung innerhalb des ursprünglichen Ablaufs darf ausschließlich die neue Verwendung weiterhin auf die dortigen Elternparameter verweisen. Erforderliche externe Ergebnisreferenzen erhalten keinen aus einem fremden Testfall übernommenen Standardwert.

Bei `replaceSelection: true` ersetzt die neue Verwendung die ausgewählte Folge und erzeugt eine neue Testfallrevision. Dadurch wird eine vorhandene Fachfreigabe veraltet. Bei nachgewiesener Gleichwertigkeit verwendet die Promotion die bereits vorhandene Definition, statt ein Duplikat anzulegen.

### Einen KI-Vorschlag annehmen

`POST /api/testing/reuse/:jobId/accept` nimmt genau einen Vorschlag eines abgeschlossenen Wiederverwendungsauftrags an. Die Eingabe lautet beispielsweise:

```json
{
  "proposalIds": ["vorschlag-123"],
  "edits": [
    {
      "id": "vorschlag-123",
      "name": "Police erneut ausgeben und drucken",
      "parameters": []
    }
  ]
}
```

`edits` ist optional. Ohne Bearbeitung gelten Name und Parameter des Vorschlags. `parentPath` und `instanceIds` stammen aus dem gespeicherten Vorschlag. Ein Pfad wie `standard/vorbereiten` bezeichnet die inneren Schritte des Vorbereitungsblocks; `sachbearbeitung` bezeichnet die Schritte des Rollenblocks. Der Server reicht diesen Pfad unverändert an die Promotion weiter.

Die Route akzeptiert ausschließlich Vorschläge zu einem gespeicherten erfolgreichen Lauf. Aktuelle Testfallrevision und Fachfingerprint müssen noch mit diesem Lauf übereinstimmen. Ein bereits angenommener oder veralteter Vorschlag ergibt HTTP 409. Mehrere IDs in einem Aufruf ergeben HTTP 400, damit jede Aufnahme eine eigene menschliche Entscheidung bleibt.

Die Annahme veröffentlicht die Definition mit `replaceSelection: false`. Sie strukturiert den getesteten Ablauf nicht um. Deshalb können mehrere verschachtelte Vorschläge desselben erfolgreichen Laufs nacheinander angenommen werden. Ergänzte Wissensrückverweise verändern die bestehende Fachfreigabe nicht. Der ursprüngliche Testfall und das eingefrorene Kompilat des Laufs bleiben unverändert; der Entscheidungsstatus des Vorschlags wird im Lauf und im Agentenauftrag fortgeschrieben.

Am angenommenen Vorschlag werden der tatsächlich veröffentlichte Name und die menschlich angenommene Parameterliste gespeichert. Ein Neuladen zeigt daher die Entscheidung des Menschen. Die ursprüngliche KI-Ausgabe bleibt in den Agentenartefakten erhalten.

### Eine Dublettenentscheidung übernehmen

`POST /api/testing/jobs/:jobId/resolve-duplicates` übernimmt eine menschliche Auswahl aus dem geprüften Dublettenbericht eines abgeschlossenen technischen Auftrags. `choices` enthält Paare aus `proposed` und `chosen`, jeweils mit `id` und `version`. Nur als kompatible Wiederverwendung geprüfte Paare sind zulässig.

Die Route prüft den seit dem Auftrag unveränderten Fachstand und ersetzt auch Verwendungen innerhalb verschachtelter Kompositionen. Anschließend validiert sie den gesamten geänderten Ablauf. Ein erfolgreicher Ersatz erzeugt eine neue Testfallrevision und gibt `requiresApproval: true` zurück. Die bisherige Freigabe gilt für diese geänderte Fassung nicht. Historische Läufe behalten ihren ursprünglichen Fach- und Technikstand.

## Graph und Änderungsfolgen

`buildTestingGraph(catalog?, scenarios?, runs?, revisions?)` liefert Knoten und gerichtete Beziehungen. Aktuelle Testfälle verweisen auf ihre aktuelle Revision. Läufe verweisen auf die exakte geprüfte Revision und eingefrorene technische Bindungen.

`getTestingImpact(bindingId, catalog?, scenarios?, runs?)` liefert direkte und indirekte Definitionsnutzer, aktuelle Testfälle mit Verwendungswegen, historische Läufe und `suggestedScenarioIds` für den gezielten erneuten Test. Die optionalen Datenparameter ermöglichen isolierte Prüfungen ohne Änderung des lokalen Benutzerbestands.


## HTTP-Vertrag des Studios

Alle Pfade beginnen mit `/api/testing`. Die Antworten sind die Datentypen aus `shared/testing.ts`; Fehler enthalten `error` und `code` mit passendem HTTP-Status.

| Route | Eingabe und Ergebnis |
| --- | --- |
| `GET /bootstrap` | `{catalog,scenarios,jobs,runs,approvals,layouts,cli}` |
| `POST /jobs/business` | `{request,model}` → Agentenauftrag, HTTP 202 |
| `PUT /scenarios/:id` | `{scenario,expectedRevision}` → gespeicherte neue Szenariorevision |
| `POST /scenarios/:id/approve` | `{revision,comment?}` → Freigabe genau dieser fachlichen Fassung |
| `POST /scenarios/:id/interpret-override` | `{revision,instanceId,text,model}` → Agentenauftrag mit lokalem Diff; noch nicht gespeichert |
| `POST /jobs/technical` | `{scenarioId,revision,model,repairBindingId?}` → Agentenauftrag einschließlich Dublettenprüfung und echtem Browserlauf |
| `POST /scenarios/:id/run` | `{revision,model?}` → tatsächlicher Browserlauf mit vorhandenen Bindungen |
| `POST /runs/:id/reuse` | `{model}` → erneute KI-Wiederverwendungsprüfung des bereits bestandenen, unveränderten Laufs, ohne Browserlauf oder neue Versicherungsobjekte |
| `GET /jobs/:id` / `POST /jobs/:id/cancel` | Fortschritt lesen oder laufenden Auftrag abbrechen |
| `POST /jobs/:id/resolve-duplicates` | `{choices:[{proposed,chosen}]}` → gleichwertige geprüfte Auswahl als neue fachliche Revision; erneute Freigabe erforderlich |
| `POST /reuse/:id/accept` | `{proposalIds:[id],edits?:[{id,name?,parameters?}]}` → genau **einen** Vorschlag annehmen; `parentPath` wird unverändert an die verschachtelte Promotion übergeben |
| `POST /reuse/:id/dismiss` | `{proposalIds:[id]}` → Vorschlag verwerfen |

`model` ist ausschließlich `luna` oder `sol`. Der technische Probelauf verwendet genau die vom Agenten ausgewählten Bindungsrevisionen. Ein zwischenzeitlich veränderter fachlicher Stand kann nicht mit einem alten Agentenergebnis überschrieben werden. Eine Annahme nach erfolgreichem Lauf prüft dessen Revision und Fingerprint erneut.

`GET /jobs/:id/attempts` listet den ursprünglichen und gegebenenfalls den einmaligen Korrekturversuch. Prompt, Manifest, Schema und Rohantwort sind über `/jobs/:id/attempts/:attempt/artifacts/:filename` zugänglich. Beide Antworten bleiben getrennt erhalten. Die bestehende direkte Route `/jobs/:id/artifacts/:filename` verweist auf den ersten Versuch.
