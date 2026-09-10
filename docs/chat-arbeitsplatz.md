# Testfälle im Chat-Arbeitsplatz bearbeiten

Der Chat-Arbeitsplatz liegt unter [`/testing/chat`](http://127.0.0.1:5173/testing/chat). Die klassische Ansicht bleibt unter [`/testing`](http://127.0.0.1:5173/testing) erreichbar. Beide Oberflächen lesen und ändern dieselben gespeicherten Testfälle. Ein Wechsel kopiert keine Daten und legt keinen zweiten Testfall an.

## Einen Testfall erstellen oder öffnen

"Neuer Testfall" öffnet einen leeren Eingabebereich. Erst wenn du eine konkrete Anforderung schickst, startet die fachliche Erkundung. Das gewählte lokale Modell gilt für diesen Auftrag.

Die linke Liste enthält die vorhandenen Testfälle. Ein Klick öffnet den Testfall und seine gespeicherte Unterhaltung. Dabei startet kein Agentenauftrag. Die Adresse enthält die Kennung der Unterhaltung und die gewählte Ansicht, zum Beispiel `/testing/chat/CHAT_ID/flow`. Solche Adressen funktionieren auch nach einem Neuladen der Seite.

## Die drei Ansichten

### Unterhaltung

Hier stehen deine Anforderungen, öffentliche Statusmeldungen, Rückfragen, Antworten und Änderungsvorschläge. Agentenbeiträge nennen die konkrete Aufgabe und den ausführenden Agenten. Über "Details" siehst du die validierte Zusammenfassung, ihre Fakten und die verwendeten fachlichen Quellen.

Du kannst auch während eines laufenden Auftrags schreiben. "Nachricht gespeichert" bestätigt zuerst nur die Annahme durch den Server. "Neuplanung gestartet" erscheint, sobald ein Folgeauftrag angelegt wurde. Die Nachricht verändert keinen bereits laufenden Modellaufruf. Der Server beendet diesen Auftrag kontrolliert und startet danach den Folgeauftrag mit dem bisherigen Stand und deiner Ergänzung. Eine Antwort auf eine Rückfrage setzt den unterbrochenen Auftrag mit diesem Bezug fort. Bei einem bestehenden Ablauf erzeugt eine neue Anweisung zuerst einen Vorschlag. "Vorschlag übernehmen" ändert den gespeicherten Testfall. "Vorschlag verwerfen" lässt den bestätigten Ablauf unverändert.

Die Unterhaltung zeigt zusammengefasste, dauerhaft gespeicherte Ereignisse. Sie zeigt keine privaten Überlegungen, Tool-Aufrufe, Sitzungskennungen oder Rohantworten des Modells. Der Agent streamt derzeit auch keine Tokens und schreibt keine Blöcke einzeln sichtbar in die Arbeitsfläche. Nach einem abgeschlossenen Arbeitsschritt liefert der Server einen neuen prüfbaren Stand oder einen Änderungsvorschlag.

### Ablauf

Die Scratch-Arbeitsfläche zeigt den bestätigten Ablauf. Liegt bereits ein strukturell gültiger vorläufiger Stand vor, zeigt sie diesen als schreibgeschützte Vorschau mit Ziel und fachlichen Quellen. Dieser Stand ist noch nicht fachlich freigegeben. Während der Agent den Entwurf bearbeitet, ist sie schreibgeschützt. Ein Änderungsvorschlag erscheint ebenfalls schreibgeschützt, bis du ihn in der Unterhaltung übernimmst oder verwirfst.

Ohne laufenden Auftrag kannst du Blöcke verschieben, hinzufügen, duplizieren oder löschen. Ein Klick auf einen Block öffnet den Inspector für Werte und Verknüpfungen. Unter der Arbeitsfläche liegt die typisierte Testmatrix. "Revision speichern" schreibt Scratch-Ablauf und Matrix gemeinsam als neue Revision.

Der Browser speichert manuelle Entwürfe pro Testfall. Sie bleiben bei einem Tabwechsel, einem Neuladen und nach einem fehlgeschlagenen Speicherversuch erhalten. Wenn die klassische Ansicht zwischenzeitlich eine neuere Revision speichert, überschreibt der Chat-Arbeitsplatz den lokalen Entwurf nicht. Er meldet den Konflikt und verhindert das Speichern gegen den veralteten Stand.

Definitionen, Wissensquellen und weitere technische Details bearbeitest du über "Erweiterte Bearbeitung" in der klassischen Ansicht. Der Link öffnet dort denselben Testfall.

### Browser

Vor dem ersten Lauf zeigt die Ansicht eine Übersicht und den Knopf "Test starten". Der Start ist ausdrücklich und erfolgt getrennt von der technischen Vorbereitung.

Während eines echten Playwright-Laufs zeigt die Ansicht ungefähr einmal pro Sekunde das zuletzt aufgenommene Browserbild. Das Bild stammt aus dem laufenden Browser und ist schreibgeschützt. Nach dem Lauf zeigt die Ansicht die gespeicherten Screenshots der Testschritte als Nachweise. Nachweise einer älteren Testfallrevision sind als historisch markiert.

## Freigabe, Vorbereitung und Lauf

Die drei Aktionen bleiben getrennt:

1. "Freigeben" bestätigt die fachliche Revision.
2. "Technisch vorbereiten" prüft und erstellt die technische Bindung für genau diese Revision.
3. "Test starten" führt den vorbereiteten Stand im echten Browser aus.

Der Server bestimmt, welche Aktion im aktuellen Zustand erlaubt ist. Ein laufender Auftrag kann abgebrochen werden. Die Oberfläche behauptet keinen Abbruch, bevor der Server ihn bestätigt hat.

## Zustände und Schnittstelle

Das Frontend lädt Katalog, Testfallliste und Modelle über schmale Teststudio-Endpunkte. Für eine Unterhaltung verwendet es drei Teile der Chat-Schnittstelle:

- Ein Zustandsabruf liefert Unterhaltung, Timeline, bestätigten Testfall, offenen Vorschlag, Lauf und erlaubte Befehle.
- Der Ereignisstrom liefert neue öffentliche Einträge und Hinweise auf geänderten Zustand. Seine Sequenznummer ist nur ein Cursor für die Reihenfolge der Ereignisse.
- Ein Befehlsaufruf führt eine erlaubte Aktion aus. Er enthält die erwartete Unterhaltungsrevision. Bei einem vorhandenen Testfall enthält er außerdem Testfallrevision und Fingerprint.

Unterhaltungsrevision, Ereigniscursor und Testfall-Fingerprint haben verschiedene Aufgaben. Die Revision schützt Befehle vor doppelter oder veralteter Ausführung. Der Cursor ordnet Ereignisse nach einem Neuverbinden. Revision und Fingerprint verhindern, dass ein alter Chat-Vorschlag eine neuere Änderung aus der klassischen Ansicht überschreibt.

Die Oberfläche entscheidet nur über Navigation und Darstellung. Sie leitet keine weiteren Agentenstarts aus Statusmeldungen ab. Agenten-, Freigabe-, Vorbereitungs- und Laufbefehle laufen über den Server und werden dort gegen den aktuellen Stand geprüft.

Die technische Einrichtung der lokalen Modelle steht in der [KI-Anbindung](codex-anbindung.md). Die klassische Arbeitsfolge erklärt der [Teststudio-Arbeitsbereich](test-workspace.md).
