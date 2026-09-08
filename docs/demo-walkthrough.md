# Eine Tierversicherung vom Portal bis zum Testlauf

Diese Anleitung führt durch die aktuelle deutsche Anwendung. Das [blaue Portal](http://127.0.0.1:5173/portal) und das [grüne Teststudio](http://127.0.0.1:5173/testing) haben getrennte Oberflächen. Öffne sie am besten in zwei Browser-Tabs. Die Startbefehle und Voraussetzungen stehen in der [README](../README.md#schnellstart).

Das Portal kann ohne Modellaufruf bedient werden. Für die KI-Aufträge im Studio muss die ausgewählte lokale Codex- oder Claude-CLI angemeldet sein und die Modellverbindung erreichen. Details stehen in der [Codex-Anbindung](codex-anbindung.md).

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

1. Prüfe zunächst als Vermittler die sichtbaren Felder „Entscheidung“ und „Begründung der Entscheidung“. Beide müssen gesperrt sein. Allein ihre Sichtbarkeit würde noch keine Bedienberechtigung belegen.
2. Wähle die Benutzerrolle „Direktion“.
3. Prüfe, dass die beiden Felder jetzt bedienbar sind. Wähle „Freigeben“ und ergänze eine nachvollziehbare „Begründung der Entscheidung“, etwa „Wertnachweis für das Zuchttier geprüft“.
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

## 5. Einen Testfall beginnen und wiederfinden

Öffne im Teststudio „Testfall erstellen“ und beschreibe unter „Deine Anforderung“ zum Beispiel:

> Ich möchte eine Tierlebensversicherung für die Kuh Berta auf einem Betrieb in Bayern. Die Versicherungssumme beträgt 15.000 Euro. Prüfe, dass nach dem Einreichen eine offene Direktionsanfrage besteht. Der Vertrag soll noch nicht abgeschlossen werden.

Wähle das Modell und starte den Entwurf. Der Auftrag erscheint direkt im Arbeitsbereich. Der Testfall ist bereits gespeichert und unter „Alle Testfälle“ auffindbar, auch wenn noch kein fertiger Blockablauf vorliegt. Ein Klick auf den Testfall öffnet wieder denselben Arbeitsbereich.

Der Fortschritt unterscheidet Anforderung, Erkundung und Entwurf, fachliche Prüfung, technische Vorbereitung und Ergebnis. Nach der fachlichen Freigabe startet die technische Vorbereitung automatisch. Bereits erreichte Schritte kannst du zur Ansicht erneut öffnen, ohne den Agenten neu zu starten. Jede Agentenkarte öffnet ein Dialogfenster mit dem tatsächlichen Ergebnis und den öffentlichen Erläuterungen dieses Auftrags. Ein einzelnes KI-Ergebnis bedeutet noch nicht, dass der gesamte Auftrag abgeschlossen ist. Laufende Teilaufträge und offene Entscheidungen bleiben sichtbar.

## 6. Wissen und Anwendung erkunden

Die KI prüft zuerst die vorhandenen Wissensdokumente und Bausteine. Bei einer Wissenslücke kann sie die aktuelle Portaloberfläche in einer separaten lokalen Testumgebung bedienen. Dabei bleiben deine gespeicherten Versicherungsfälle unverändert.

Die Erkundung liefert Beobachtungen und gegebenenfalls neues Wissen für den Entwurf. Eine Beobachtung beschreibt beispielsweise, welche Felder das Formular zeigt. Sie beweist nicht automatisch, dass eine fachliche Versicherungsregel vollständig verstanden wurde. Offene Fragen müssen weiterhin geklärt werden.

## 7. Den Scratch-Ablauf prüfen

Der erste Beispieltest soll bei einer offenen Direktionsanfrage enden. Ein automatischer Vertragsabschluss würde seine Anforderung verändern. Für einen Test der Policenausgabe wäre dagegen zunächst ein vollständiger Standardvertrag erforderlich.

1. Wähle einen Scratch-Block aus oder öffne die tastaturbedienbare „Ablaufliste“.
2. Prüfe im Inspector die Werte, vor allem Versicherungssumme, Betriebsadresse, Tierart und Rollen.
3. Öffne bei Bedarf die verknüpften Wissensgrundlagen und die enthaltenen Schritte eines zusammengesetzten Blocks.
4. Ergänze fehlende Blöcke oder lasse die KI den gesamten Ablauf anhand einer neuen Anweisung überarbeiten.
5. Speichere deine Änderungen und gib den fachlichen Stand ausdrücklich frei. Danach startet die technische Vorbereitung automatisch.

Der Scratch-Block zeigt seine wirksamen Abweichungen direkt als benannte Werte. Unveränderte Standardwerte bleiben dort ausgeblendet; in den Eigenschaften lassen sie sich weiterhin ansehen und ändern. Die Auswahl einer Ergebnisquelle nennt den früheren Schritt, der beispielsweise einen Vorschlag erzeugt hat. Du musst dafür keine interne Kennung kennen.

Lose Scratch-Stapel gehören nicht zum ausführbaren Ablauf. Verbinde benötigte Schritte mit der Startkette. Das Layout selbst legt keine fachliche Reihenfolge fest.

### Einen fehlenden Block ergänzen

„Block hinzufügen“ öffnet zuerst den durchsuchbaren Katalog. Dort kannst du einen vorhandenen Block einfügen oder eine neue Definition anlegen. Die normale Einfügung legt einen Block frei auf der Arbeitsfläche ab; „Am Ende anhängen“ verbindet ihn direkt mit dem Ablauf.

Bei einer neuen Definition beschreibst du Name, Blockart, Voraussetzungen und erwartete Wirkung. Eingaben erhalten jeweils einen Namen, Typ, eine Pflichtfeldangabe und bei Bedarf einen Standardwert. Technische Schlüssel und Versionen musst du nicht eingeben. Fehlt die Wissensgrundlage, kannst du sie beim Definieren selbst ergänzen. Du musst keinen unpassenden bestehenden Eintrag auswählen.

Eine neue Fähigkeit kann zunächst ohne technische Bindung beschrieben werden. Die technische Phase muss anschließend klären, ob und wie sie im Portal ausgeführt werden kann. Ein fehlendes Produktmerkmal darf nicht durch einen erfundenen erfolgreichen Test ersetzt werden. Meldet die technische Vorbereitung eine nicht unterstützte Fähigkeit, zeigt Schritt 4 „Technische Fragen klären“ den Abschnitt „Mit KI überarbeiten“. Wähle dort das „Lokale Modell für die fachliche Überarbeitung“ und starte mit „Mit KI überarbeiten“ einen Vorschlag. Prüfe und übernimm ihn bei Bedarf. Gib den neuen Stand danach mit „Freigeben und technisch prüfen“ erneut frei. „Manuell im Ablauf bearbeiten“ bleibt möglich.

### Eine bestehende Verwendung ändern

Die verwendete Blockversion und ihre lokalen Werte sind getrennt. Eine andere Versicherungssumme oder ein Betrieb in Bayern können lokale Abweichungen sein. Die Veröffentlichung einer neuen Bibliotheksversion aktualisiert nicht still alle Testfälle.

Die KI-Überarbeitung steht als eigener Abschnitt unter der Arbeitsfläche. Beschreibe dort die Änderung und wähle das Modell direkt für diesen Auftrag.

Eine KI-Änderung ist ein Vorschlag. Prüfe die Unterschiede, bevor du sie übernimmst. Jede fachliche Änderung benötigt eine erneute Freigabe; ältere Nachweise bleiben ihrem damaligen Stand zugeordnet.

## 8. Technik und Browserlauf

Nach der fachlichen Freigabe startet die technische Vorbereitung im selben Arbeitsbereich. Der Fortschritt zeigt getrennt, ob die technische Umsetzung noch läuft, der Vergleich mit anderen Bausteinen eine Entscheidung verlangt oder der Browser bereits testet. Der fachliche Prüfschritt wird dabei nicht erneut als erledigt angezeigt.

Ist bereits passende Technik vorhanden, kannst du den Test direkt damit ausführen. „Technik neu vorbereiten“ öffnet bei Bedarf einen Dialog mit der Modellauswahl für eine erneute Vorbereitung. Meldet der technische Schritt eine nicht unterstützte Fähigkeit, erscheint dort der Abschnitt „Mit KI überarbeiten“. Nach der menschlichen Prüfung und erneuten Freigabe mit „Freigeben und technisch prüfen“ beginnt die technische Vorbereitung für den neuen Stand erneut.

Bei einem Wiederverwendungsvorschlag prüfst du den vorgeschlagenen anderen Baustein, seine Übereinstimmungen und Unterschiede. Eine andere Version desselben Blocks wird nicht als eigenständige Dublette behandelt. Eine erforderliche Erweiterung ist eine fachliche Aufgabe und noch kein bestandener Browserlauf.

Der Browserlauf führt die freigegebene Folge tatsächlich im Portal aus. Er erzeugt fiktive Versicherungsobjekte und hält die getestete Revision, verwendete Bindungen und Schrittnachweise fest. Öffne bei Bedarf den fehlgeschlagenen Schritt oder die Screenshots. Ein früherer grüner Lauf belegt keine später geänderte Fassung.

Erst das Ergebnis eines passenden Browserlaufs zeigt „bestanden“ oder „fehlgeschlagen“. Protokolle und interne technische Daten stehen unter den Details. Scheitert ein KI-Arbeitsschritt, bleibt der Testfall erhalten und kann im Arbeitsbereich fortgesetzt werden.

## 9. Wiederverwenden und nachpflegen

Nach einem bestandenen Lauf können Vorschläge für wiederverwendbare Teilabläufe entstehen. Sie sind ein optionaler nächster Schritt. Eine fehlgeschlagene Wiederverwendungsanalyse ändert das Browserergebnis nicht.

Prüfe Namen, enthaltene Schritte und veränderbare Eingaben eines Vorschlags. „Als Baustein übernehmen“ veröffentlicht den gewählten Ablauf in der Blockbibliothek. Interne Verknüpfungen zwischen den Schritten bleiben innerhalb des Bausteins erhalten.

Unter „Bibliothek & Wissen“ findest du außerdem Abhängigkeiten und historische Ausführungen. Eine geänderte Portal-Schaltfläche lässt sich dadurch ihrer technischen Bindung und den betroffenen Testfällen zuordnen. Historische Läufe behalten ihre ursprünglichen Nachweise.

Die [Beschreibung des Arbeitsbereichs](test-workspace.md) erklärt die Zustände. Die [Blockmethode](block-method.md) und das [Speichermodell](storage-model.md) erklären Wiederverwendung und Versionen. Agentenartefakte unter `.local/testing/agents/` sowie Browsernachweise unter `.local/testing/runs/` bleiben lokal und gehören nicht ins öffentliche Repository.
