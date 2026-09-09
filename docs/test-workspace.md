# Ein Arbeitsbereich pro Testfall

Die Erstellung eines Testfalls folgt einer fachlichen Reihenfolge. Die Oberfläche zeigt den aktuellen Schritt, das Ergebnis des letzten Schritts und eine nächste Aktion. Erläuterungen und Nachweise öffnen sich über beschriftete Buttons in Dialogen. Die Blockbearbeitung bleibt dadurch im Mittelpunkt.

## Einstieg und Wiederaufnahme

„Testfall erstellen“ ist der Arbeitsbereich für neue und bereits begonnene Tests. „Alle Testfälle“ ist die Sammlung. Sobald ein Auftrag gestartet wurde, gehört er zu einem gespeicherten Testfall. Auch ein fehlgeschlagener oder abgebrochener erster Auftrag bleibt dort auffindbar.

Die Adresse des Testfalls, seine gespeicherte Revision und zugehörige Aufträge bestimmen den angezeigten Stand. Ein Wechsel der Seite oder ein erneutes Laden darf weder einen zweiten Test erzeugen noch einen laufenden Auftrag als beendet darstellen. Lokale Änderungen bleiben erkennbar und müssen vor einer neuen fachlichen Freigabe gespeichert werden.

## Fachlicher Ablauf

| Schritt | Was der Mensch sieht | Wann es weitergeht |
| --- | --- | --- |
| Anforderung | Ein Eingabefeld, die Modellauswahl und der Start | Sobald der Wunsch beschrieben ist |
| Wissen und Anwendung erkunden | Was bereits bekannt ist, welche Frage noch offen ist und woran die KI arbeitet | Sobald ein prüfbarer Entwurf oder eine konkrete offene Frage vorliegt |
| Ablauf prüfen | Scratch-Blöcke mit editierbaren Werten | Nach fachlicher Prüfung und ausdrücklicher Freigabe |
| Test vorbereiten und ausführen | Umsetzung, Vergleich mit anderen Bausteinen und Browserlauf als getrennte Arbeitsschritte | Die technische Vorbereitung startet nach der Freigabe automatisch. Danach folgt der Browserlauf, sobald die nötigen Entscheidungen vorliegen. |
| Ergebnis | Bestanden oder fehlgeschlagen, mit den passenden Nachweisen | Der Test kann erneut ausgeführt oder überarbeitet werden |

Bereits erreichte Schritte lassen sich über die Schrittleiste erneut ansehen. Nach der fachlichen Freigabe zeigt der technische Schritt nur seinen eigenen aktuellen Stand. Der alte fachliche Prüfschritt wird dort nicht nochmals als erledigt gezählt. Der Wechsel zurück zur Erkundung zeigt die damaligen Agentenergebnisse; er startet keinen neuen Auftrag und verändert keine Freigabe.

Ein beendeter KI-Aufruf ist kein bestandener Test. Die KI kann einen Vorschlag geliefert haben, der noch geprüft werden muss. Ebenso kann eine technische Planung eine fehlende Fähigkeit oder eine mögliche Wiederverwendung melden, ohne bereits einen Browserlauf auszuführen.

## Fortschritt verstehen

Beim ersten Entwurf arbeitet die KI der Reihe nach: einen passenden Titel bestimmen, vorhandenes Wissen prüfen, bei Bedarf die Anwendung erkunden und anschließend den Ablauf entwerfen. Der übergeordnete Auftrag verwaltet diese Schritte. Er zählt dabei nicht als zusätzlicher, parallel arbeitender Agent.

In der technischen Vorbereitung können zwei Arbeiten gleichzeitig laufen: die Browseraktionen vorbereiten und die Bausteine mit bestehenden Definitionen vergleichen. Die Anzeige trennt diese Arbeitszweige und zeigt ihren jeweiligen Stand. Der Browserlauf folgt erst, wenn die dafür notwendigen Prüfungen abgeschlossen sind.

Abgeschlossene Schritte und beobachtete Aktionen zeigen den Fortschritt. Sie sind keine Schätzung der verbleibenden Zeit. Jede Agentenkarte öffnet ihr eigenes Dialogfenster mit dem tatsächlichen Ergebnis und den verständlichen öffentlichen Erläuterungen dieses Auftrags. Reine Empfangsbestätigungen und technische Werkzeugereignisse gehören nicht in diese Erläuterungen. Benannte Wissensquellen und Browserbelege lassen sich von dort öffnen. Die Anzeige zählt protokollierte Werkzeugmeldungen im verfügbaren Verlauf; Browserbeobachtungen werden separat gezählt. Eine fehlende neue Modellmeldung bedeutet nicht automatisch, dass der Auftrag stehen geblieben ist.

Für die Erkundung hält die KI ihre Prüffragen fest. Diese Liste bleibt über die einzelnen Modellaufrufe erhalten. So kann beispielsweise die Frage nach einer dritten Benutzerrolle nicht verschwinden, nachdem zwei andere Rollen geprüft wurden. Beantwortete Fragen verweisen auf ihre Belege; offene Fragen verhindern einen vollständigen Abschluss.

Ein Zeitlimit, eine technische Unterbrechung und ein ausdrücklich angeforderter Abbruch sind unterschiedliche Ursachen. Die Anwendung darf einen technischen Abbruch nicht dem Menschen zuschreiben. Der gespeicherte Testfall bleibt auch nach einer Unterbrechung erhalten.

## Zustände und Nachweise

| Zustand | Nächste Handlung |
| --- | --- |
| Ein Auftrag läuft | Fortschritt ansehen oder abbrechen |
| Lokale fachliche Änderungen | Speichern und erneut fachlich prüfen |
| Offene Frage oder ungültiger fachlicher Ablauf | Die betroffene Angabe klären |
| Gültiger Ablauf ohne aktuelle Freigabe | Fachlich freigeben. Dadurch startet die technische Vorbereitung automatisch. |
| Freigegeben, technische Vorbereitung läuft | Ergebnis der technischen Agenten abwarten oder die betroffene Karte öffnen |
| Wiederverwendung oder Erweiterung vorgeschlagen | Den konkreten Vergleich beurteilen |
| Zugeordneter Browserlauf fehlgeschlagen | Den fehlgeschlagenen Schritt prüfen |
| Zugeordneter Browserlauf bestanden | Ergebnis ansehen; Wiederverwendung optional prüfen |

Bei vorhandener Technik bleibt die direkte Ausführung die Hauptaktion. Für eine erneute technische Vorbereitung gibt es eine eigene Schaltfläche mit Modellauswahl im Dialog.

Meldet die technische Vorbereitung eine nicht unterstützte Fähigkeit, zeigt der technische Schritt „Technische Fragen klären“ einen eigenen Abschnitt „Mit KI überarbeiten“. Dort wählst du das „Lokale Modell für die fachliche Überarbeitung“ und formulierst die gewünschte fachliche Änderung. Mit „Mit KI überarbeiten“ startest du den Vorschlag. Du prüfst ihn, übernimmst ihn bei Bedarf und gibst den neuen fachlichen Stand mit „Freigeben und technisch prüfen“ erneut frei. „Manuell im Ablauf bearbeiten“ bleibt möglich.

Ein Ergebnis gehört zu einem konkreten Auftrag und dessen Fachstand. Ein alter grüner Lauf darf nicht als Ergebnis eines neueren, noch unvollständigen Auftrags erscheinen. Nach einer fachlichen Änderung bleiben ältere Nachweise in der Historie, gelten aber nicht als Nachweis für die Änderung.

## Blöcke bearbeiten und freigeben

Im Prüfschritt steht die Scratch-Arbeitsfläche oben. Ein Klick auf einen Block öffnet dessen Eigenschaften als Overlay. Ein Klick auf die freie Arbeitsfläche schließt es wieder. Die Vollbildansicht vergrößert den Arbeitsbereich; sie soll die Blöcke nicht durch automatisches Herauszoomen verkleinern.

Im Block stehen nur Werte, die von den Vorgaben seiner verwendeten Definition abweichen. Alle Eingaben bleiben in den Eigenschaften bearbeitbar. Auch bei verschachtelten Blöcken beziehen sich die Änderungen auf die tatsächlich wirksamen Werte.

„Block hinzufügen“ öffnet den Katalog. Suche zuerst nach einer vorhandenen Fähigkeit. Ist keine passende vorhanden, lässt sich im Katalog eine neue Definition anlegen. Die normale Einfügung legt den Block frei in der Arbeitsfläche ab; „Am Ende anhängen“ fügt ihn direkt in den Ablauf ein. Freie Blöcke bleiben gespeichert, werden aber erst ausgeführt, wenn sie mit der Startkette verbunden sind.

Unter der Arbeitsfläche steht die KI-Überarbeitung als eigener Abschnitt. Dort beschreibst du die gewünschte Änderung und wählst das Modell für diesen Auftrag. Der Vorschlag wird erst nach deiner Übernahme zum gespeicherten Ablauf.

Die fachliche Freigabe zeigt getrennte Zähler für Informationen, Warnungen und Fehler. Ein Klick öffnet die zugehörigen Hinweise mit dem betroffenen Schritt oder Feld. Eine noch fehlende technische Bindung ist in dieser Phase eine Information: Die technische Umsetzung folgt später. Ungültige fachliche Eingaben verhindern dagegen die Freigabe.

## Wissen entsteht während der Arbeit

Vorhandenes Wissen wird zuerst ausgewertet. Reicht es nicht aus, kann die KI die aktuelle Portaloberfläche in einer separaten lokalen Umgebung erkunden. Beobachtungen aus dieser Erkundung belegen, was die Oberfläche tatsächlich zeigt und welche Eingaben möglich waren. Sie ersetzen keine fachliche Bestätigung einer Versicherungsregel.

Beim Definieren eines Blocks gibt der Mensch einen Namen, die Blockart und Eingaben an. Pro Eingabe stehen Name, Typ, Pflichtfeld und gegebenenfalls Standardwert zusammen. Ein Standardwert passt zu stabilen, sicheren und wiederholt passenden Ausgangswerten, wenn der Block auch ohne den ausgeblendeten Wert eindeutig bleibt. Generische Rollen-, Berechtigungs-, Entscheidungs- und Prüfblöcke verlangen ihre fachlich entscheidenden Werte ausdrücklich. Ein spezialisierter Block darf einen konstanten Wert kapseln, den sein Name und seine Bedeutung eindeutig nennen. Interne Schlüssel und Versionen werden automatisch verwaltet. Voraussetzungen und erwartete Wirkung beschreiben für den Agenten, wann der Block verwendbar ist und was er erreichen soll.

Die Aktualisierung einer vorhandenen gemeinsamen Definition öffnet vor dem Speichern eine Auswirkungsprüfung. Sie zählt betroffene Testfälle und Testmatrixzeilen, nennt sie einzeln und zeigt direkte sowie über zusammengesetzte Blöcke erreichte Stellen mit lesbaren Blocknamen. Ein Testfalltitel lässt sich für die Gegenprüfung separat öffnen. Erst nach der Entscheidung über alle offenen Werte kann die Definition zusammen mit den betroffenen Testfallrevisionen übernommen werden. Ein gerade bearbeiteter Testfall wird zuvor gespeichert; ein Speicherkonflikt stoppt die Vorschau. „Vorschau aktualisieren“ behält die bearbeitete Definition und die bereits getroffenen Wertentscheidungen bei. Hat sich ein Testfall oder der Katalog seit der Vorschau geändert, lehnt der Server die alte Vorschau ohne Teiländerung ab.

Wird ein Standardwert entfernt, speichert die Übernahme den bisher geerbten Standard ausdrücklich im Testfall. Dessen fachliche Aussage bleibt dadurch gleich. Ändert sich ein Standardwert, entscheidet der Mensch je betroffener Stelle, ob der neue Standard gelten oder der bisherige Wert ausdrücklich erhalten bleiben soll. Bereits ausdrücklich gesetzte abweichende Werte bleiben erhalten. Entfernte Felder, nicht mehr erlaubte Auswahlwerte, inkompatible Typwechsel und neue Pflichtfelder blockieren die Übernahme, bis jeder Wert geprüft neu gesetzt, zugeordnet oder verworfen wurde. Die Vorschau zeigt auch die Wirkung auf jede aktivierte Testmatrixzeile.

Über „Wissen hinzufügen“ lassen sich bestehende Quellen auswählen oder neue Wissensbeschreibungen ergänzen. Die neue Wissensbeschreibung und ihre Verbindung zum Block werden gemeinsam gespeichert. Es ist nicht nötig, einen beliebigen vorhandenen Wissenseintrag auszuwählen, nur um den Dialog abschließen zu können.

## Dubletten und gemeinsame Blockdefinitionen

Eine interne Revision desselben Blocks ist keine eigenständige Dublette. Im Editor gibt es je stabiler Block-ID genau eine aktuelle gemeinsame Definition; ein Testfall wählt keine ältere Fassung aus. Ein Dublettenvergleich untersucht dagegen andere Bausteine und erklärt, was fachlich übereinstimmt, welche Eingaben abweichen und welche Entscheidung erforderlich ist.

Eine Änderung der gemeinsamen Definition aktualisiert alle aktuellen direkten und verschachtelten Verwendungen in einem gemeinsamen Schritt. Die Auswirkungsprüfung verhindert dabei, dass eine sichtbare Scratch-Blockdefinition und der tatsächlich gespeicherte Test auseinanderlaufen. Historische Läufe bleiben eingefroren. Wiederverwendungsvorschläge nach einem bestandenen Lauf sind optional; ihr Fehlschlagen macht den bestandenen Browserlauf nicht rückwirkend ungültig.
