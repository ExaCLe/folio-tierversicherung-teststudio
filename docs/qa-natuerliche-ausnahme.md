# Eine natürlichsprachliche Ausnahme mit Sol prüfen

Diese Anleitung prüft, ob Sol eine örtlich begrenzte Änderung vorschlägt, der Mensch sie vor dem Speichern vergleichen kann und die gemeinsame Blockdefinition erhalten bleibt. Die Beispieldaten sind fiktiv. Ein Clone enthält keine zugehörigen Modellantworten, Screenshots oder bereits bestandene lokale Abnahme.

## Ausgangspunkt vorbereiten

Starte die Anwendung nach der [README](../README.md#schnellstart) und richte für diesen Test die [lokale Codex-Anbindung](codex-anbindung.md) ein. Der [Demoguide](demo-walkthrough.md#7-eine-lokale-ausnahme-formulieren) beschreibt die Bedienung der Ausnahmefunktion.

1. Öffne im lokalen Teststudio den vorbereiteten Testfall "Kuh mit hoher Versicherungssumme" und wähle Sol.
2. Wähle den zusammengesetzten Block zur Vorbereitung des Kuhvorschlags. Prüfe, dass die Versicherungssumme 15.000 EUR beträgt.
3. Notiere die gespeicherte Testrevision, die aktuellen Betriebswerte, Kundenanschrift und Kuhdaten sowie die verwendeten Definitionsversionen. Speichere gegebenenfalls noch offene eigene Änderungen.

Die Durchführung verändert den lokalen Testfall, sobald du den geprüften Vorschlag übernimmst und speicherst. Verwende dafür einen Prüfbestand, dessen Ausgangsstand du vergleichen kannst.

## Die Ausnahme anfordern

Gib unter "Eine Ausnahme beschreiben" ein:

> Ändere nur den Betrieb in diesem vorbereitenden Baustein: Bundesland Bayern, Betriebsstraße Dorfstraße 12, Betriebspostleitzahl 87437 und Betriebsort Kempten. Behalte die Versicherungssumme von 15.000 Euro, alle Kuhdaten, den Kunden samt Kundenanschrift und sämtliche übrigen Schritte unverändert. Die gemeinsame Blockdefinition darf nicht geändert werden; dies ist nur eine lokale Ausnahme für diesen Testfall.

Klicke auf "Änderung vorschlagen" und warte auf den abgeschlossenen Agentenauftrag. Prüfe dort das verwendete Modell und mögliche Fehler. Sol wird im Adapter als `gpt-5.6-sol` aufgerufen. Ein fehlgeschlagener Auftrag benötigt eine eigene Fehlerbeurteilung, bevor die Prüfung fortgesetzt werden kann.

## Den Vorschlag vergleichen

Die Gegenüberstellung muss die Änderung auf diese Betriebswerte begrenzen:

| Feld | Erwarteter Vorschlag |
| --- | --- |
| Bundesland | Bayern |
| Betriebsstraße | Dorfstraße 12 |
| Betriebspostleitzahl | 87437 |
| Betriebsort | Kempten |

Vergleiche auch die enthaltenen Schritte. Kunde und Kundenanschrift, Kuhdaten, Versicherungssumme, übrige Eingaben, Rollen, Reihenfolge und Ergebnisverbindungen müssen dem Ausgangsstand entsprechen. Die Ausnahme darf keine neue gemeinsame Definition oder Wissensquelle voraussetzen.

Vor der Übernahme muss der gespeicherte Testfall noch dieselbe Revision besitzen. Der Modellauftrag liefert zunächst einen prüfbaren Vorschlag. Die fachliche Bedeutung der Änderung muss im Vergleich sichtbar sein.

## Übernehmen, speichern und neu laden

1. Wähle "Änderungen in Entwurf übernehmen". Prüfe die vier Betriebswerte im bearbeitbaren Entwurf.
2. Kontrolliere, dass die gespeicherte Testrevision bis zu diesem Zeitpunkt unverändert ist.
3. Klicke auf "Speichern". Prüfe, dass eine neue Testrevision entsteht.
4. Lade die Seite neu und öffne den enthaltenen Betriebsblock. Kontrolliere Bayern, Dorfstraße 12, 87437 Kempten sowie die unveränderten übrigen Daten.
5. Vergleiche die gemeinsame Blockdefinition und ihre Version mit dem Ausgangsstand.
6. Öffne den älteren Änderungsvorschlag erneut. Seine Übernahme muss für die inzwischen geänderte Revision gesperrt sein.

Falls der fertige Vorschlag nach dem Modellaufruf nicht sichtbar wird, dokumentiere den UI-Fehler und den Agentenauftrag. Das spätere Öffnen eines gespeicherten Vorschlags ist eine Wiederaufnahme mit eigenem Prüfergebnis. Wiederhole einen Modellauftrag nur, wenn ein neuer Vorschlag benötigt wird.

Die Abnahme ist bestanden, wenn der Vorschlag ausschließlich die vier Betriebswerte ändert, Übernahme und Speichern als getrennte Schritte funktionieren, der gespeicherte Zustand ein Neuladen übersteht und ein veralteter Vorschlag gesperrt bleibt.

## Eigene Nachweise erfassen

Halte Ausgangsrevision, ausgewähltes Modell, Ergebnis des Agentenauftrags und die fachlichen Vergleiche fest. Sinnvolle Nachweise sind Screenshots vor der Übernahme und nach dem Neuladen sowie der Vergleich von Testfall, aufgelöstem Ablauf und Definitionsversionen. Die [Teststudio-API](testing-api.md) beschreibt die gespeicherten Daten und Aufträge.

Modellartefakte legt die Anwendung standardmäßig unter `.local/testing/agents/` an. Zusätzliche eigene Prüfnotizen und Screenshots können unter `.local/testing/reviews/` aufbewahrt werden. Git ignoriert `.local/`; diese Unterlagen werden nicht veröffentlicht.

Die enthaltenen Editorregressionen lassen sich separat ausführen:

```sh
npm run test:e2e -- e2e/testing-editor-review.spec.ts
```

Sie prüfen Editorverhalten mit vorbereiteten Testdaten. Die hier beschriebene Sol-Abnahme benötigt zusätzlich den tatsächlichen Modellaufruf und die fachliche Prüfung seines Ergebnisses.
