# Testfälle im Chat-Arbeitsplatz bearbeiten

Der Chat-Arbeitsplatz liegt unter [`/testing/chat`](http://127.0.0.1:5173/testing/chat). Die klassische Ansicht bleibt unter [`/testing`](http://127.0.0.1:5173/testing) erreichbar. Beide Oberflächen lesen und ändern dieselben gespeicherten Testfälle. Ein Wechsel kopiert keine Daten und legt keinen zweiten Testfall an.

## Einen Testfall erstellen oder öffnen

"Neuer Testfall" öffnet einen leeren Eingabebereich. Erst wenn du eine konkrete Anforderung schickst, startet die fachliche Erkundung. Das gewählte lokale Modell gilt für diesen Auftrag.

Die linke Liste enthält die vorhandenen Testfälle. Ein Klick öffnet den Testfall und seine gespeicherte Unterhaltung. Dabei startet kein Agentenauftrag. Die Adresse enthält die Kennung der Unterhaltung und die gewählte Ansicht, zum Beispiel `/testing/chat/CHAT_ID/flow`. Solche Adressen funktionieren auch nach einem Neuladen der Seite.

## Die drei Ansichten

### Unterhaltung

Hier stehen deine Anforderungen, geprüfte Antworten und Änderungsvorschläge in einer schmalen Lesespalte. Laufende und abgeschlossene Arbeiten erscheinen als Aufgabenkarten an der zeitlich passenden Stelle. Die Karten nennen ihren Zweck und einen dafür gewählten Agentennamen mit eigener Farbe. Ein laufender Auftrag zeigt einen Spinner, ein abgeschlossener ein Häkchen. Wartende und noch nicht gestartete Aufträge erscheinen als kompakte Queue-Zeilen ohne Spinner. Wartet ein übergeordneter Auftrag auf einen Teilauftrag, führt ein Link direkt zu dessen Details. Scheitert der Teilauftrag, zeigt die übergeordnete Zeile den Blocker, ohne denselben Fehler ein zweites Mal als eigenen Fehler auszugeben. Ein Klick öffnet die öffentlichen Fortschritts- und Ergebnismeldungen. Interne Statusmeldungen, Browserbeobachtungen und Modellnamen erscheinen nicht als Chatantworten.

Du kannst auch während eines laufenden Auftrags eine separate Änderung schreiben. Diese Nachricht verändert keinen bereits laufenden Modellaufruf. Der Server beendet diesen Auftrag kontrolliert und startet danach den Folgeauftrag mit dem bisherigen Stand und deiner Ergänzung. Bei einem bestehenden Ablauf erzeugt die Anweisung zuerst einen Vorschlag. "Vorschlag übernehmen" ändert den gespeicherten Testfall. "Vorschlag verwerfen" lässt den bestätigten Ablauf unverändert.

Offene Rückfragen stehen gemeinsam in einem hervorgehobenen Eingabebereich. Sie erscheinen nur, wenn eine wichtige fachliche Entscheidung fehlt. Eine ausdrückliche Anforderung des Nutzers gilt bereits als Soll; Wissensprüfung und Browsererkundung bleiben Aufgaben des Agenten. Jede Rückfrage hat ein eigenes Textfeld, eine Begründung und den Namen des wartenden Agenten. "Antwort speichern" übermittelt nur diese eine Antwort. Weitere Fragen dürfen offen bleiben. Nicht gesendete Texte bleiben pro Unterhaltung und Frage im Browser erhalten, auch nach einem Neuladen oder fehlgeschlagenen Versuch. Sobald alle nötigen Antworten vorliegen, setzt der Server den wartenden Auftrag genau einmal fort. Solange Rückfragen offen sind, bleibt der normale Eingabebereich geschlossen. "Andere Änderung schreiben" öffnet ihn bewusst als separate Nebenaktion.

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

Beim Serverstart schreibt das Terminal die Adresse des Chat-Arbeitsplatzes. In Terminals mit OSC-8-Unterstützung ist sie anklickbar. `FORCE_HYPERLINK=1` erzwingt den OSC-8-Link, falls die automatische Erkennung im verwendeten Terminal nicht greift. Ohne Link-Unterstützung bleibt die ausgeschriebene URL als kopierbarer Fallback stehen.

Die technische Einrichtung der lokalen Modelle steht in der [KI-Anbindung](codex-anbindung.md). Die klassische Arbeitsfolge erklärt der [Teststudio-Arbeitsbereich](test-workspace.md).
