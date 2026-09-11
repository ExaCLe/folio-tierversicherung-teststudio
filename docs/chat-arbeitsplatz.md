# Testfälle im Chat-Arbeitsplatz bearbeiten

Der Chat-Arbeitsplatz liegt unter [`/testing/chat`](http://127.0.0.1:5173/testing/chat). Die klassische Ansicht bleibt unter [`/testing`](http://127.0.0.1:5173/testing) erreichbar. Beide Oberflächen lesen und ändern dieselben gespeicherten Testfälle. Ein Wechsel kopiert keine Daten und legt keinen zweiten Testfall an.

## Einen Testfall erstellen oder öffnen

"Neuer Testfall" öffnet einen leeren Eingabebereich. Erst wenn du eine konkrete Anforderung schickst, startet die fachliche Erkundung. Das gewählte lokale Modell gilt für diesen Auftrag.

Die linke Liste enthält die vorhandenen Testfälle. Ein Klick öffnet den Testfall und seine gespeicherte Unterhaltung. Dabei startet kein Agentenauftrag. Die Adresse enthält die Kennung der Unterhaltung und die gewählte Ansicht, zum Beispiel `/testing/chat/CHAT_ID/flow`. Solche Adressen funktionieren auch nach einem Neuladen der Seite.

## Die drei Ansichten

### Unterhaltung

Hier stehen deine Anforderungen, geprüfte Antworten und Änderungsvorschläge in einer schmalen Lesespalte. Laufende und abgeschlossene Arbeiten erscheinen an dem Zeitpunkt, an dem der Agent sie tatsächlich bearbeitet oder abgeschlossen hat. Die Karten nennen ihren Zweck und den Agentennamen. Ein laufender Auftrag zeigt einen Spinner, ein abgeschlossener ein Häkchen. Wartende und noch nicht gestartete Aufträge stehen getrennt unter "Als Nächstes". Hat eine technische Vorbereitung bereits gearbeitet und ein Hindernis gemeldet, bleibt sie mit ihrem Ergebnis chronologisch im Verlauf. Nach einer fachlichen Korrektur sperrt dieser historische Bericht keine neue Vorbereitung. Dadurch erscheinen geplante technische Arbeiten nicht vor der fachlichen Freigabe, die sie erst auslöst. Wartet ein Auftrag auf einen Teilauftrag, führt ein Link direkt zu dessen Details.

Ein Klick auf eine Aufgabe öffnet ihre öffentlichen Meldungen. Der Detaildialog trennt die öffentliche Zusammenfassung der Bearbeitung, die tatsächliche Agentenausgabe, strukturierte Ergebnisse und automatische Vertragsprüfungen. Eine automatische Schema- oder Compilerprüfung heißt ausdrücklich "Automatisierte Prüfung". Die Oberfläche nennt nur dann eine KI-Prüfung, wenn der Server dafür einen eigenen belegten Bericht liefert. Quellen bleiben am Bericht verlinkt. Neue Meldungen erscheinen während eines laufenden Auftrags im geöffneten Dialog. Interne Überlegungen, Tool-Aufrufe und Sitzungskennungen erscheinen nicht.

Neue Aufträge speichern die vom Anbieter ausgegebenen Reasoning-Zusammenfassungen. Provider-Zusammenfassungen, die eine ältere Version bereits verworfen hat, lassen sich durch das Update nicht rekonstruieren. Vorhandene gespeicherte Ergebnisse und Prüfberichte bleiben erhalten; bei älteren Aufträgen zeigt der Dialog ehrlich, wenn keine Reasoning-Zusammenfassung vorliegt.

Du kannst auch während eines laufenden Auftrags eine separate Änderung schreiben. Diese Nachricht verändert keinen bereits laufenden Modellaufruf. Der Server beendet diesen Auftrag kontrolliert und startet danach den Folgeauftrag mit dem bisherigen Stand und deiner Ergänzung. Bei einem bestehenden Ablauf erzeugt die Anweisung zuerst einen Vorschlag. "Vorschlag übernehmen" ändert den gespeicherten Testfall. "Vorschlag verwerfen" lässt den bestätigten Ablauf unverändert.

Offene Rückfragen stehen gemeinsam in einem hervorgehobenen Eingabebereich. Sie erscheinen nur, wenn eine wichtige fachliche Entscheidung fehlt. Eine ausdrückliche Anforderung des Nutzers gilt bereits als Soll; Wissensprüfung und Browsererkundung bleiben Aufgaben des Agenten. Jede Rückfrage hat ein eigenes Textfeld, eine Begründung und den Namen des wartenden Agenten. "Antwort speichern" übermittelt nur diese eine Antwort. Weitere Fragen dürfen offen bleiben. Nicht gesendete Texte bleiben pro Unterhaltung und Frage im Browser erhalten, auch nach einem Neuladen oder fehlgeschlagenen Versuch. Sobald alle nötigen Antworten vorliegen, setzt der Server den wartenden Auftrag genau einmal fort. Solange Rückfragen offen sind, bleibt der normale Eingabebereich geschlossen. "Andere Änderung schreiben" öffnet ihn bewusst als separate Nebenaktion.

Die Unterhaltung zeigt zusammengefasste, dauerhaft gespeicherte Ereignisse. Eigene Entscheidungen wie eine Freigabe erscheinen als grüne Aktion mit "Du hast ..." und werden nicht Folio zugeschrieben. Der Agent streamt keine Tokens und schreibt keine Blöcke einzeln sichtbar in die Arbeitsfläche. Nach einem abgeschlossenen Arbeitsschritt liefert der Server einen neuen prüfbaren Stand oder einen Änderungsvorschlag.

Aufgabenkarten zeigen, sofern der Anbieter sie liefert, Dauer, belegte API-Anfragen sowie Eingabe-, Cache-, Ausgabe- und Gesamttokens. Cache-Tokens sind ein Teil der Eingabe und werden deshalb separat ausgewiesen; sie werden nicht zusätzlich zur Gesamtsumme addiert. Neue Codex-Aufträge zählen einzelne API-Anfragen über die lokale Telemetrie der CLI, einschließlich erneuter Versuche. Dafür wird je Auftrag kurzzeitig ein eigener Empfänger auf dem lokalen Rechner geöffnet; seine Nachrichten werden nicht gespeichert. Bei älteren Sitzungen oder Anbietern ohne genaue Anfragezahl steht „API-Anfragen unbekannt“; CLI-Sitzungen und Modellrunden werden nicht als API-Anfragen gezählt. Fehlende Tokenwerte bleiben leer. Eine angezeigte Null ist ein gemessener Wert.

### Ablauf

Die Scratch-Arbeitsfläche zeigt den aktuellen Arbeitsstand. Eine kleine anklickbare Statuszeile direkt über den Blöcken zeigt laufende Agentenarbeit mit Spinner, Modell, Arbeitsschritt und Laufzeit. Sie führt zur Unterhaltung; währenddessen bleibt die Fläche schreibgeschützt. Vorläufige Vorschauen und Änderungsvorschläge bleiben schreibgeschützt, bis du sie in der Unterhaltung prüfst und übernimmst oder verwirfst. Die Arbeitsfläche bewahrt dabei deine lokale Kopie.

Ohne laufenden Auftrag kannst du Blöcke verschieben, hinzufügen, duplizieren oder löschen; bis zu 30 Schritte lassen sich über „Rückgängig“ und „Wiederholen“ auch nach einem Neuladen lokal bearbeiten. „Speichern“ schreibt Ablauf und Matrix gemeinsam als neue Revision. Einen neu eingegangenen Agentenstand übernimmst du bewusst, damit deine Änderungen erhalten bleiben; ältere Backend-Revisionen bleiben für Freigaben und Nachweise verfügbar.

Der Browser speichert manuelle Entwürfe pro Testfall. Sie bleiben bei einem Tabwechsel, einem Neuladen und nach einem fehlgeschlagenen Speicherversuch erhalten. Wenn die klassische Ansicht zwischenzeitlich eine neuere Revision speichert, überschreibt der Chat-Arbeitsplatz den lokalen Entwurf nicht. Er meldet den Konflikt und verhindert das Speichern gegen den veralteten Stand.

Der Ablauf-Chat bleibt kompakt, solange keine Eingabe aktiv ist. Beim Fokussieren oder Schreiben wird er im Inhaltsbereich zentriert und wächst mit dem Text bis zu einer begrenzten Höhe. Lange Antworten des letzten Arbeitsschritts umbrechen innerhalb des Bereichs, damit Modellwahl und Senden auf kleinen Bildschirmen erreichbar bleiben. Unter dem Inhalt wird die tatsächliche Höhe des Eingabebereichs freigehalten, damit auch die letzte Matrixzeile vollständig erreichbar bleibt.

Definitionen, Wissensquellen und weitere technische Details bearbeitest du über "Erweiterte Bearbeitung" in der klassischen Ansicht. Der Link öffnet dort denselben Testfall.

### Browser

Vor dem ersten Lauf zeigt die Ansicht eine Übersicht und den Knopf "Test starten". Der Start ist ausdrücklich und erfolgt getrennt von der technischen Vorbereitung.

Während eines echten Playwright-Laufs zeigt die Ansicht ungefähr einmal pro Sekunde das zuletzt aufgenommene Browserbild. Das Bild stammt aus dem laufenden Browser und ist schreibgeschützt. Nach dem Lauf zeigt die Ansicht die gespeicherten Screenshots der Testschritte als Nachweise. Nachweise einer älteren Testfallrevision sind als historisch markiert.

## Freigabe, Vorbereitung und Lauf

Die drei Aktionen bleiben getrennt. Die Unterhaltung bietet für eine noch nicht freigegebene Fassung den Link "Ablauf prüfen". Er öffnet die Ablaufansicht. Erst dort ist "Freigeben" verfügbar, damit die fachliche Fassung vor der Bestätigung sichtbar ist.

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
