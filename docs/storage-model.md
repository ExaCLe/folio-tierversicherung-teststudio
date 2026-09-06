# Speicherung und Verbindungen der Testbausteine

Die Testwerkstatt speichert fachliche Bedeutung, konkrete Verwendung und technische Ausführung getrennt. Eine Versicherungssumme darf für einen einzelnen Test geändert werden, während eine Button-Umbenennung an einer zentralen technischen Bindung behoben werden kann.

## Die Datensätze

| Datensatz | Identität | Enthält |
| --- | --- | --- |
| Blockdefinition | stabile ID und semantische Version | Bedeutung, Eingabeschema, Ergebnisse, Wissen, Vor- und Nachbedingungen, optional enthaltene Blöcke |
| Blockverwendung | lokale ID innerhalb einer Komposition | gepinnte Definitionsversion, konkrete Werte, Ergebnisnamen, lokale Abweichungen |
| Testfall | stabile ID und Revision | Testziel, geordnete Startkette, Erwartung, Wissensverweise |
| Editorzustand | Testfall-ID | Positionen, Zoom, Auswahl, eingeklappte Gruppen und lose Blöcke |
| Wissensdokument | stabile ID und Revision | Fachregel oder Verfahren, erforderliche Felder, Bedingungen und Definitionsverweise |
| Technische Bindung | stabile ID und technische Revision | elementarer Vorgang, unterstützte Definitionsversionen, Lokatoren, UI-Rezept und verwendete Eingaben |
| Fachfreigabe | eigene ID | Testfallrevision, Fachfingerprint, prüfende Person und Zeitpunkt |
| Testlauf | eigene ID | eingefrorener Fach- und Technikstand, reale Schritte, Ergebnisse und Artefakte |

Eine Definition hat eine semantische Version wie `1.0.0`. Eine technische Bindung hat eine davon unabhängige fortlaufende Revision. Die technische Revision 4 ist keine neue fachliche Version des Blocks.

## Eine konkrete Verwendung

Die Definition „Kuhlebensversicherung vorbereiten“ kann viele Verwendungen haben. Eine Verwendung setzt die hohe Versicherungssumme, eine andere behält den Standard:

```json
{
  "id": "kuh-mit-hoher-summe",
  "definition": {
    "id": "ablauf.kuh-vorschlag",
    "version": "1.0.0"
  },
  "inputs": {
    "sumInsured": 15000,
    "state": "Bayern",
    "farmStreet": "Dorfstraße 12",
    "farmPostalCode": "87437",
    "farmCity": "Kempten"
  },
  "outputs": {
    "proposal": "mein-vorschlag"
  }
}
```

Das Schema und die gemeinsame Komposition stehen in der Definition. Die Abweichungen und der gewünschte Ergebnisname stehen in dieser Verwendung. Eine zweite Verwendung mit `sumInsured: 3500` bleibt davon unabhängig.

Im nächsten Block kann `proposalId` den Wert `{ "ref": "mein-vorschlag" }` besitzen. Diese Referenz ist typisiert. Eine Kundenreferenz ist kein zulässiger Ersatz für eine Vorschlagsreferenz. Eine Referenz auf ein erst später erzeugtes Ergebnis ist ebenfalls ungültig.

## Verschachtelung, Parameter und lokale Änderungen

Ein zusammengesetzter Block enthält eine `body`-Liste. Seine Eingaben können darin als `{ "param": "sumInsured" }` verwendet werden. Der Compiler löst diese Parameter rekursiv auf und verbindet die internen Ergebnisse.

Eine Verwendung kann über `overrides` einzelne Werte eines enthaltenen Blocks ändern. Die Schlüssel sind relative Pfade wie `vorbereiten/betrieb`. Eine Verwendung kann außerdem eine eigene `children`-Komposition enthalten. Diese ist eine ausdrückliche lokale Abweichung vom gepinnten Definitionskörper und wird bei der Fachfreigabe vollständig berücksichtigt.

Interne Ergebnisnamen sind lokal. Zwei Verwendungen desselben Vorbereitungsblocks können intern beide „kunde“ heißen. Bei der Kompilierung entstehen verschiedene Namen wie `erster/kunde::customer` und `zweiter/kunde::customer`. Doppelte Ergebnisnamen auf derselben Ebene bleiben ein Fehler.

Ein Rollenblock bildet einen fachlichen Benutzerkontext. Die enthaltenen Aktionen erhalten die gewählte Rolle. Seine Ergebnisse können im äußeren Ablauf weiterverwendet werden.

Eine zusammenhängende Auswahl kann auch innerhalb eines Rollen- oder Workflowblocks zur Wiederverwendung aufgenommen werden. `parentPath` bezeichnet dafür die übergeordnete Verwendung. Äußere Ergebnisreferenzen und Parameter werden zu ausdrücklichen Eingaben des neuen Blocks. Eine Ersetzung verändert ausschließlich die gewählte Ebene.

## Vier verschiedene Änderungsfälle

| Änderung | Neuer Datensatz | Folge |
| --- | --- | --- |
| In einem Test die Summe auf 15.000 EUR setzen | neue Testfallrevision | Fachfreigabe wird veraltet |
| Ein neues fachliches Pflichtfeld ergänzen | neue Definitionsversion und eventuell Wissensrevision | betroffene Verwendungen müssen bewusst auf die neue Version wechseln |
| Einen Button-Locator reparieren | neue technische Bindungsrevision | Fachfreigabe bleibt gültig; betroffene Tests erneut ausführen |
| Einen Block im Arbeitsbereich verschieben | neuer Editorzustand | fachlicher Ablauf und Freigabe bleiben gleich |

Definitionen, Wissensrevisionen und technische Bindungsrevisionen sind unveränderlich. Dieselbe ID-Version-Kombination darf nicht still mit anderem Inhalt überschrieben werden. Das Repository weist einen solchen Versuch mit HTTP 409 zurück.

Eine neue Definitionsversion aktualisiert keine bestehenden Verwendungen automatisch. Das schützt Tests vor unbemerkten Änderungen gemeinsamer Standards. Die technische Bindung kann dagegen zentral repariert werden, weil sie die unveränderte fachliche Fähigkeit ausführt.

## Was eine Fachfreigabe genau bestätigt

Der Fachfingerprint berücksichtigt den kanonischen Testfall, konkrete Werte und lokale Abweichungen, alle transitiv beteiligten Definitionsinhalte sowie die Bedeutung der relevanten fachlichen Wissensdokumente.

Er berücksichtigt keine Positionen, lose Blöcke oder Zoomwerte. Technische Bindungsrevisionen sind ebenfalls getrennt. Ein geänderter Locator macht die fachliche Erwartung nicht falsch.

Auch reine Wissensrückverweise sind getrennt. Wenn ein neuer Block ein vorhandenes Wissensdokument verwendet, erhält das Dokument einen ergänzten Rückverweis. Solange Inhalt, Regeln, Pflichtfelder und Bedingungen unverändert bleiben, veraltet dadurch keine bestehende Fachfreigabe. Eine geänderte Fachregel oder ein neues Pflichtfeld verändert den Fingerprint dagegen sehr wohl.

Ein Lauf speichert trotzdem die konkret verwendeten Wissensrevisionen. Fachliche Gleichheit und historische Nachweisbarkeit sind unterschiedliche Aufgaben.

## Wissen in beide Richtungen

Die Definition nennt ihre `knowledgeRefs`. Das Wissensdokument nennt seine `definitionRefs`. Eine neu gespeicherte Definition ergänzt fehlende Rückverweise als neue Wissensrevision. Der Speichergraph zeigt beide Richtungen.

Fachliche Dokumente beschreiben Bedeutung, erforderliche Angaben, Vorbedingungen und Ergebnisse. Technische Dokumente beschreiben Portalrouten, UI-Verweise und die Anbindung. Dadurch lässt sich eine veränderte Oberfläche bearbeiten, ohne die Produktregeln in UI-Anweisungen aufzulösen.

Die Einstiegshilfe für den Agenten ist `knowledge/agriculture/methode.zwei-freigaben.md`. Sie nennt die Dokumente, die bei Tierdaten, Direktionsanfragen oder Policendruck zu lesen sind. Die einzelnen Dokumente bleiben über stabile IDs auffindbar.

## Von der kleinsten Bindung zu allen betroffenen Tests

Der Graph verbindet eine technische Bindungsrevision mit den elementaren Definitionsversionen, die sie ausführt. Von dort folgt er Verwendungen in zusammengesetzten Blöcken und Testfällen. Historische Läufe verweisen zusätzlich auf ihren eigenen eingefrorenen Stand.

Der Änderungsfolgenbericht liefert:

1. direkt betroffene elementare Definitionen;
2. indirekt betroffene zusammengesetzte Definitionen mit Verbindungsweg;
3. aktuelle Testfälle und die konkreten Pfade der betroffenen Verwendungen;
4. historische Läufe mit der damals verwendeten Bindungsrevision;
5. eine Liste der aktuellen Testfälle für den gezielten erneuten Lauf.

Für eine Reparatur des Policendrucks ist der Direktionsanfrage-Test beispielsweise nicht betroffen. Für eine Reparatur von „Kunden anlegen“ sind beide Beispieltests betroffen, weil beide über verschachtelte Vorbereitungsblöcke Kunden erzeugen.

## Was ein Browserlauf einfriert

Vor der Ausführung speichert der Lauf eine Kopie des Testfalls, der benutzten Definitionsversionen, Wissensdokumente, technischen Bindungen und kompilierten Schritte. Jeder Schritt besitzt den Pfad seiner Blockverwendung und die konkrete Bindungsrevision.

Der Browserlauf ergänzt reale Ergebnisse, Screenshots, Trace und Quellnachweise. Eine spätere Reparatur ersetzt diese alten Daten nicht. Ein neuer Lauf belegt den neuen Stand.

Ein Schritt kann fachlich gültig und trotzdem nicht ausführbar sein. Dann fehlt beispielsweise seine technische Bindung oder die Verwendung eines zusätzlichen Eingabefelds. Der Compiler weist diese Lücke aus; er erzeugt keinen erfolgreichen Lauf.

## Lokale Ablage und atomare Übernahme

Die Quellen der neuen Bibliothek liegen unter `catalog/agriculture`. Die Wissensdokumente liegen unter `knowledge/agriculture`. Vom Benutzer und den Agenten erzeugte Datensätze liegen in der lokalen Datenbank mit Kollektionen wie `testingDefinitions`, `testingKnowledge`, `testingBindings`, `testingScenarios`, `testingScenarioRevisions`, `testingLayouts`, `testingApprovals` und `testingRuns`.

Ein Agentenentwurf mit neuen Definitionen und Wissen wird vor seiner Übernahme vollständig auf Versionskonflikte und neue Referenzen geprüft. Anschließend übernimmt ein einzelner atomarer Schreibvorgang die zusammengehörigen neuen Datensätze. Ein ungültiger späterer Teil des Entwurfs hinterlässt keine zuvor gespeicherten verwaisten Bausteine.

Der lokale Speicher schreibt die gesamte JSON-Datei über eine temporäre Datei und anschließendes Umbenennen. Er ist für den lokalen Prototyp gedacht. Er ersetzt keine Datenbank für mehrere gleichzeitig laufende Serverprozesse. Die neuen Kollektionen verändern die Daten des früheren Sachversicherungsprototyps nicht.

Die Quellen des Schemas stehen in `shared/testing.ts`. Der Compiler liegt in `server/testing/compiler.ts`, die Speicherung in `server/testing/repository.ts` und die Verfolgung der Abhängigkeiten in `server/testing/graph.ts`.
