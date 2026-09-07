# Eine Tierversicherung vom Portal bis zum Testlauf

Diese Anleitung führt durch die aktuelle deutsche Anwendung. Das [blaue Portal](http://127.0.0.1:5173/portal) und das [grüne Teststudio](http://127.0.0.1:5173/testing) haben getrennte Oberflächen. Öffne sie am besten in zwei Browser-Tabs. Die Startbefehle und Voraussetzungen stehen in der [README](../README.md#schnellstart).

Das Portal kann ohne Modellaufruf bedient werden. Für die KI-Aufträge im Studio muss die lokale Codex-CLI angemeldet sein und die Modellverbindung erreichen. Details stehen in der [Codex-Anbindung](codex-anbindung.md).

## 1. Eine Standardkuh im Portal versichern

1. Öffne das Portal und wähle oben bei „Benutzerrolle“ den „Vermittler“.
2. Klicke auf „Neuer Versicherungsvorschlag“ und anschließend „Standardkuh laden“.
3. Prüfe den vorgefüllten Kunden Johanna Bauer mit Anschrift in Uelzen. „Kunde speichern“ legt den Kunden an. Erst „Weiter zu Betrieb“ öffnet den nächsten Schritt.
4. Prüfe Hof Lindenkamp, Niedersachsen, Dorfstraße 12, 29525 Uelzen. Klicke auf „Betrieb speichern“ und dann „Weiter zu Tier / Bestand“.
5. Prüfe Alma: Rind, Fleckvieh, Nutzung Milchkuh, Ohrmarke, Geburtsdatum und Versicherungssumme 3.500 EUR. Klicke auf „Tier speichern“ und anschließend „Weiter zu Vorschlag“.
6. Prüfe das Produkt Tierlebensversicherung und den Versicherungsbeginn. „Vorschlag speichern“ öffnet den gespeicherten Entwurf.
7. Klicke auf „Angebot berechnen“. Der Jahresbeitrag beträgt für dieses fiktive Beispiel 122,50 EUR.
8. Klicke auf „Antrag einreichen“. Der Vorgang wird „Freigegeben“. „Vertrag abschließen“ erzeugt den Vertrag, eine eigene Police und Dokumentversion 1.

Kunde, Betrieb, Tier, Vorschlag, Vertrag und Police sind getrennte Datensätze. In der Detailansicht stehen ihre Nummern und unter den jeweiligen Nachweisen ihre Kennungen. Ein erneutes Laden der Seite erhält den Vorgang.

## 2. Eine hohe Summe und einen Betrieb in Bayern erfassen

Beginne einen neuen Vorschlag mit „Standardkuh laden“. Die Beispieldaten sind zunächst ungespeichert. Verwende bei Bedarf einen anderen Kundennamen, um den zweiten Vorgang in der Übersicht leicht zu erkennen.

Ändere im Betriebsschritt die Betriebsdaten:

| Feld | Wert der Bayern-Variante |
| --- | --- |
| Betriebsname | Bauernhof Sonnleitner |
| Bundesland | Bayern |
| Betriebsstraße | Dorfstraße 12 |
| Betriebspostleitzahl | 87437 |
| Betriebsort | Kempten |

Die Kundenanschrift bleibt in Uelzen. Ein Betriebsstandort ist eine eigene Angabe. Im Tierformular setzt „Hohe Versicherungssumme“ für ein Rind 15.000 EUR. Alternativ kann der Betrag direkt eingegeben werden.

Speichere Tier und Vorschlag, berechne das Angebot und reiche den Antrag ein. Jetzt muss „Direktionsprüfung“ erscheinen. Die Direktionsanfrage besitzt eine eigene Nummer und nennt die überschrittene Annahmegrenze. Bei genau 10.000 EUR entsteht wegen der Summe noch keine Anfrage.

1. Versuche zunächst, als Vermittler eine Entscheidung zu speichern. Die Entscheidung ist für diese Rolle gesperrt.
2. Wähle die Benutzerrolle „Direktion“.
3. Wähle „Freigeben“ und ergänze eine nachvollziehbare „Begründung der Entscheidung“, etwa „Wertnachweis für das Zuchttier geprüft“.
4. Klicke auf „Entscheidung speichern“. Der Vorschlag ist nun „Freigegeben“.
5. Wechsle zurück zum Vermittler und klicke auf „Vertrag abschließen“.

Für eine Ablehnung wählst du bei einem anderen offenen Antrag „Ablehnen“ und begründest die Entscheidung. Dieser Vorgang kann anschließend nicht abgeschlossen werden. Der Verlauf erhält die Entscheidung und die handelnde Rolle.

## 3. Die Police erneut ausgeben und drucken

Öffne einen abgeschlossenen Vorgang, beispielsweise über „Verträge & Policen“ und „Police öffnen“.

1. Wähle die Benutzerrolle „Sachbearbeiter“.
2. Ergänze den „Grund der erneuten Ausgabe“, etwa „Ersatzausfertigung auf Kundenwunsch“.
3. Klicke auf „Police erneut ausgeben“. Die Police behält ihre Nummer; eine neue Dokumentkennung und Dokumentversion 2 entstehen.
4. Wähle die gewünschte „Dokumentversion“ und klicke auf „Police drucken“.
5. Prüfe den sichtbaren Hinweis „Druckauftrag erfasst“. Er nennt die Rolle und die konkrete Dokumentversion. Im Nachweis stehen Dokumentkennung und Prüfsumme.
6. „Browserdruck öffnen“ öffnet die Druckfunktion für die Vorschau. „Dokument öffnen“ zeigt die lesbare Policenfassung in einem eigenen Tab.

Ein erfasster Druckauftrag belegt die Anforderung eines Ausdrucks. Er bestätigt keinen physischen Ausdruck. Frühere Dokumentversionen und Drucknachweise bleiben erhalten und sind über „Bearbeitungsverlauf“ erreichbar.

## 4. Weitere Tiere und mehrere Betriebe ausprobieren

Ein vorhandener Kunde kann im ersten Erfassungsschritt ausgewählt werden. Im nächsten Schritt zeigt „Betrieb auswählen“ nur seine Betriebe. Über „Neuen Betrieb erfassen“ legst du einen weiteren Betrieb an. Die Tierauswahl zeigt danach nur Tiere dieses Betriebs.

| Tierart | Was sich im Formular ändert |
| --- | --- |
| Pferd | Chipnummer, Nutzung und Gesundheitszustand; bei Vorerkrankung zusätzlich Gesundheitsangaben |
| Hund | Chipnummer, Rasse, Geburtsdatum und Nutzung, beispielsweise Hütehund |
| Schwein | Anzahl Schweine, Haltungsform und Biosicherheit für den gesamten Bestand |

Schweinebestände verwenden Bestandsversicherung. Einzeltiere verwenden Tierlebensversicherung. Die Annahmegrenzen und besonderen Prüfgründe stehen im Portal unter „Tarifhinweise“ und im [Portalvertrag](agriculture-api.md).

## 5. Eine fachliche Anforderung im Teststudio beschreiben

Öffne das Teststudio. Beschreibe unter „Deine Anforderung“ zum Beispiel:

> Ich möchte eine Tierlebensversicherung für die Kuh Berta auf einem Betrieb in Bayern. Die Versicherungssumme beträgt 15.000 Euro. Prüfe, dass nach dem Einreichen eine offene Direktionsanfrage besteht. Der Vertrag soll noch nicht abgeschlossen werden.

1. Wähle „Luna“ oder „Sol“.
2. Klicke auf „Fachlichen Entwurf erstellen“.
3. Öffne den angezeigten Agentenauftrag, um Modell, Fortschritt, Begründung und mögliche offene Fragen zu prüfen.
4. Nach einem erfolgreichen Auftrag öffnet „Entwurf ansehen“ den fachlichen Ablauf.

Ein KI-Fehler bleibt sichtbar und erzeugt keinen vorgetäuschten erfolgreichen Entwurf. Ein bereits gespeicherter Testfall kann auch ohne neuen fachlichen KI-Auftrag untersucht werden. Unter „Gespeicherte Testfälle“ sind „Kuh mit hoher Versicherungssumme“ und „Police als Sachbearbeiter drucken“ vorbereitet.

Auf der Startseite findest du unter „Bisherige Agentenaufträge“ auch frühere Aufträge. Der Dialog nennt den zugehörigen Testfall und die Auftragsrevision. „Entwurf ansehen“ öffnet diesen Testfall. Liegt inzwischen eine neuere gespeicherte Revision vor, wird der Unterschied angezeigt. Eigene ungespeicherte Änderungen bleiben im geöffneten Entwurf erhalten.

Die Leiste „Aktueller Testfall“ beziehungsweise „Zuletzt bearbeitet“ nennt Titel und Revision. Über „Testfall weiterbearbeiten“ kehrst du aus der Blockbibliothek, den Ausführungen oder einer anderen Studioseite zum Editor zurück. Auch die Zurück- und Vorwärtstasten des Browsers öffnen den Testfall, der zur Adresse gehört. Ungespeicherte Änderungen werden beim Wechsel und beim erneuten Laden im selben Browser-Tab wiederhergestellt. „Speichern“ sichert sie dauerhaft; „Verwerfen“ stellt den gespeicherten Stand wieder her.

## 6. Die Scratch-Blöcke fachlich prüfen

Der erste Beispieltest soll bei einer offenen Direktionsanfrage enden. Ein automatischer Vertragsabschluss würde seine Anforderung verändern. Der zweite Test bereitet dagegen einen vollständigen Standardvertrag vor und wechselt für Ausgabe und Druck zum Sachbearbeiter.

1. Wähle einen Scratch-Block aus oder öffne die tastaturbedienbare „Ablaufliste“.
2. Prüfe rechts unter „Werte“ die konkreten Eingaben. Achte besonders auf Versicherungssumme, Betriebsadresse, Tierart und Rollen.
3. Öffne „Wissen“, um die verknüpften Regeln und fachlichen Quellen zu lesen.
4. Prüfe bei einem zusammengesetzten Block die enthaltenen Schritte. Werte einer Verwendung dürfen vom gemeinsamen Baustein abweichen.
5. Prüfe die verbundenen Schritte der Startkette. Wenn du Blöcke aus der Scratch-Werkzeugleiste ziehst, verbinde sie mit dieser Kette. Lose abgelegte Blöcke gehören nicht zum ausführbaren Ablauf. Die Bildschirmposition allein legt keine Reihenfolge fest.
6. Speichere vorgenommene Änderungen und wähle anschließend „Fachlich freigeben“, wenn der Ablauf zur Anforderung passt.

Eine fachliche Änderung macht die frühere Freigabe ungültig. Der aktualisierte Stand braucht eine neue Prüfung. Die Freigabe bezieht sich auf den konkreten fachlichen Stand und seine Wissensgrundlagen.

### Vorhandene und eigene Blöcke ergänzen

Direkt unter der Scratch-Arbeitsfläche und der Ablaufliste stehen zwei Aktionen:

1. Wähle die „Einfügestelle“. Standardmäßig wird am Ende des Ablaufs ergänzt. Wenn ein zusammengesetzter Block ausgewählt ist, kannst du stattdessen innerhalb dieses Blocks ergänzen.
2. „Vorhandenen Block hinzufügen“ öffnet die Suche. Suche nach Namen, fachlicher Bedeutung oder Kategorie und wähle den gewünschten Block samt Version. Er wird unmittelbar an der gewählten Stelle in den Ablauf eingefügt und ausgewählt.
3. Wenn die Fähigkeit fehlt, öffne „Neuen Block definieren und hinzufügen“. Dafür muss noch kein Block im Testfall vorhanden sein. Beschreibe Name, fachliche Bedeutung und Blockart.
4. Der „Fachliche Schlüssel“ wird aus dem Namen vorgeschlagen. Er dient der internen Zuordnung und kann bei Bedarf angepasst werden. Du musst dafür keinen eigenen technischen Bezeichner erfinden.
5. Über „Eingabe ergänzen“ legst du typisierte Felder an, zum Beispiel einen „Geldbetrag“, eine „Zahl“ oder eine „Auswahl“. Ergänze passende Bezeichnungen, gegebenenfalls Pflichtangaben und Standardwerte.
6. „Definieren und zum Ablauf hinzufügen“ speichert die Definition in der Bibliothek und fügt eine Verwendung an der gewählten Stelle ein. Prüfe deren Werte und speichere den Testfall.

Fehlt die technische Bindung, zeigen Dialog und Editor dies an. Du kannst die Fähigkeit fachlich beschreiben und prüfen, bevor sie technisch ausgeführt werden kann.

### Ergebnisse früherer Schritte erkennen

Verwendet ein Block einen zuvor angelegten Kunden, Betrieb, ein Tier oder ein anderes Ergebnis, zeigen die Blockdetails die Ergebnisart, den Namen und den erzeugenden Schritt. „Quelle im Ablauf zeigen“ springt zu diesem Schritt. In der Ablaufliste wird die betreffende Zeile ausgewählt; die Scratch-Ansicht zeigt den Quellblock auch dann, wenn sein Baustein zuvor eingeklappt war.

Über die Auswahl im Referenzfeld kannst du ein anderes passendes Ergebnis aus einem früheren Schritt wählen. Noch fehlende, erst später erzeugte oder in diesem Ablaufbereich nicht verfügbare Ergebnisse werden ausdrücklich angezeigt. „Technischen Verweis anzeigen“ öffnet bei Bedarf die gespeicherte Kennung. Der erzeugende Block nennt unter „Ergebnisse dieses Schritts“ seine Ausgaben.

## 7. Eine lokale Ausnahme formulieren

Wähle einen zusammengesetzten Block, beispielsweise die Vorbereitung eines Kuhvorschlags. Unter „Eine Ausnahme beschreiben“ kannst du eingeben:

> Der Betrieb soll in Bayern liegen. Verwende Bauernhof Sonnleitner, Dorfstraße 12, 87437 Kempten. Die Anschrift des Kunden soll unverändert bleiben.

Klicke auf „Änderung vorschlagen“. Prüfe in der Gegenüberstellung, welche Felder der Agent ändern möchte. „Änderungen in Entwurf übernehmen“ übernimmt den Vorschlag in den bearbeitbaren Entwurf. Erst danach speicherst und prüfst du ihn erneut. „Verwerfen“ lässt den vorherigen fachlichen Stand bestehen.

Die Ausnahme gilt für diese Verwendung im Testfall. Sie veröffentlicht keine neue gemeinsame Blockdefinition. Wiederkehrende Unterschiede können später als Parameter eines gemeinsamen Bausteins beschrieben werden.

## 8. Technik und echten Browserlauf prüfen

Nach fachlicher Freigabe erscheint „Technik & Probelauf“. Die technische Phase prüft die vorhandenen Bindungen, fehlende Umsetzung und mögliche doppelte Bausteine. Anschließend kann der Browser die freigegebene Folge tatsächlich im Portal ausführen.

1. Klicke auf „Technik & Probelauf“ und prüfe den angezeigten Agentenfortschritt.
2. Beachte technische Lücken oder nicht unterstützte Anforderungen. Ein fachlich gültiger Entwurf ist dadurch noch kein bestandener Test.
3. Öffne nach der Ausführung „Ausführungen“ und wähle den Lauf.
4. Prüfe jeden Schrittnachweis, Screenshot und die zugehörigen Objektkennungen.
5. Öffne den erzeugten Portalvorgang und kontrolliere das fachliche Ergebnis. Beim Direktionsbeispiel ist das eine offene Anfrage; beim Policenbeispiel eine neue Dokumentversion mit passendem Druckauftrag.
6. Prüfe das Laufmanifest und bei Bedarf den Playwright-Trace. Sie dokumentieren die ausgeführte Revision und die verwendeten Bindungen.

Die Laufansicht nennt den Testfall und die tatsächlich ausgeführte Revision. „Testfall öffnen“ führt zum bearbeitbaren Testfall; „Testfall weiterbearbeiten“ in der oberen Leiste führt zum zuletzt bearbeiteten Entwurf zurück. Die Laufnachweise bleiben bei ihrer historischen Revision.

Wenn freigegebener Ablauf und passende Technik bereits vorliegen, erlaubt „Mit vorhandener Technik ausführen“ einen weiteren Browserlauf. Jeder Lauf erstellt eigene fiktive Portalobjekte und behält seine Nachweise.

Nach einem erfolgreichen Lauf können Vorschläge für wiederverwendbare Teilabläufe entstehen. Falls noch keine Vorschläge vorliegen oder die Analyse fehlgeschlagen ist:

1. Öffne den bestandenen Lauf unter „Ausführungen“ und gehe zu „Welche Teile sollen wiederverwendbar werden?“.
2. Wähle unter „Modell für Wiederverwendung“ Luna oder Sol und klicke auf „Wiederverwendung prüfen“. Der Fortschritt erscheint direkt in diesem Bereich. Die Analyse verwendet den vorhandenen erfolgreichen Lauf; sie führt den Versicherungstest nicht erneut aus und erzeugt keine neuen Versicherungsobjekte.
3. Prüfe bei jedem Vorschlag die enthaltenen Schritte und den fachlichen Zweck. Bearbeite „Name des wiederverwendbaren Blocks“ und wähle über die Checkboxen, welche Eingaben später veränderbar sein sollen. Eine interne Verknüpfung, etwa vom gerade angelegten Kunden zu seinem Betrieb, soll innerhalb des Bausteins erhalten bleiben.
4. Mit „Als Baustein übernehmen“ erscheint der geprüfte Ablauf in der Blockbibliothek. Die Karte nennt die gespeicherte Definition und ihre Version. „Vorschlag verwerfen“ lehnt einen anderen Vorschlag ab.
5. Lade die Seite erneut und prüfe die Entscheidungen sowie den neuen Eintrag in der Blockbibliothek. Der ursprüngliche Testfall, seine Freigabe und seine Browsernachweise bleiben erhalten.

Die [Blockmethode](block-method.md) beschreibt die fachliche Entscheidung; das [Speichermodell](storage-model.md) erklärt Versionen und Beziehungen.

## 9. Abhängigkeiten und Nachweise verfolgen

Unter „Abhängigkeiten“ lässt sich von einer technischen Bindung zu ihren Aktionsblöcken, umschließenden Abläufen und betroffenen Testfällen wechseln. Eine geänderte Portal-Schaltfläche kann so an der passenden Bindung korrigiert werden. Historische Ausführungen behalten die damals verwendete Revision.

Neue Browsernachweise liegen unter `.local/testing/runs/`, Agentenaufträge unter `.local/testing/agents/`. Die aktuelle [Teststudio-API](testing-api.md) dokumentiert die gespeicherten Zustände und Nachweise. Diese Demo verwendet ausschließlich fiktive Tierversicherungen.
