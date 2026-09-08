# Ein Arbeitsbereich pro Testfall

Die Erstellung eines Testfalls folgt einer fachlichen Reihenfolge. Die Oberfläche zeigt den aktuellen Schritt, das Ergebnis des letzten Schritts und eine nächste Aktion. Protokolle, interne Kennungen und historische Nachweise sind zusätzliche Details.

## Einstieg und Wiederaufnahme

„Testfall erstellen“ ist der Arbeitsbereich für neue und bereits begonnene Tests. „Alle Testfälle“ ist die Sammlung. Sobald ein Auftrag gestartet wurde, gehört er zu einem gespeicherten Testfall. Auch ein fehlgeschlagener oder abgebrochener erster Auftrag bleibt dort auffindbar.

Die Adresse des Testfalls, seine gespeicherte Revision und zugehörige Aufträge bestimmen den angezeigten Stand. Ein Wechsel der Seite oder ein erneutes Laden darf weder einen zweiten Test erzeugen noch einen laufenden Auftrag als beendet darstellen. Lokale Änderungen bleiben erkennbar und müssen vor einer neuen fachlichen Freigabe gespeichert werden.

## Fachlicher Ablauf

| Schritt | Was der Mensch sieht | Wann es weitergeht |
| --- | --- | --- |
| Anforderung | Ein Eingabefeld, die Modellauswahl und der Start | Sobald der Wunsch beschrieben ist |
| Wissen und Anwendung erkunden | Was bereits bekannt ist, welche Frage noch offen ist und woran die KI arbeitet | Sobald ein prüfbarer Entwurf oder eine konkrete offene Frage vorliegt |
| Ablauf prüfen | Scratch-Blöcke mit editierbaren Werten | Nach fachlicher Prüfung und ausdrücklicher Freigabe |
| Test vorbereiten und ausführen | Umsetzung, Vergleich mit anderen Bausteinen und Browserlauf als getrennte Arbeitsschritte | Nach einer erforderlichen Entscheidung oder abgeschlossenem Browserlauf |
| Ergebnis | Bestanden oder fehlgeschlagen, mit den passenden Nachweisen | Der Test kann erneut ausgeführt oder überarbeitet werden |

Ein beendeter KI-Aufruf ist kein bestandener Test. Die KI kann einen Vorschlag geliefert haben, der noch geprüft werden muss. Ebenso kann eine technische Planung eine fehlende Fähigkeit oder eine mögliche Wiederverwendung melden, ohne bereits einen Browserlauf auszuführen.

## Fortschritt verstehen

Beim ersten Entwurf arbeitet die KI der Reihe nach: vorhandenes Wissen prüfen, bei Bedarf die Anwendung erkunden und anschließend den Ablauf entwerfen. Der übergeordnete Auftrag verwaltet diese Schritte. Er zählt dabei nicht als zusätzlicher, parallel arbeitender Agent.

In der technischen Vorbereitung können zwei Arbeiten gleichzeitig laufen: die Browseraktionen vorbereiten und die Bausteine mit bestehenden Definitionen vergleichen. Die Anzeige trennt diese Arbeitszweige und zeigt ihren jeweiligen Stand. Der Browserlauf folgt erst, wenn die dafür notwendigen Prüfungen abgeschlossen sind.

Abgeschlossene Schritte und beobachtete Aktionen zeigen den Fortschritt. Sie sind keine Schätzung der verbleibenden Zeit. Die Erläuterungen enthalten öffentliche Statusmeldungen und Ergebnisse der einzelnen Schritte. Die Anzeige zählt protokollierte Werkzeugmeldungen im verfügbaren Verlauf; Browserbeobachtungen werden separat gezählt. Eine fehlende neue Modellmeldung bedeutet nicht automatisch, dass der Auftrag stehen geblieben ist.

Für die Erkundung hält die KI ihre Prüffragen fest. Diese Liste bleibt über die einzelnen Modellaufrufe erhalten. So kann beispielsweise die Frage nach einer dritten Benutzerrolle nicht verschwinden, nachdem zwei andere Rollen geprüft wurden. Beantwortete Fragen verweisen auf ihre Belege; offene Fragen verhindern einen vollständigen Abschluss.

Ein Zeitlimit, eine technische Unterbrechung und ein ausdrücklich angeforderter Abbruch sind unterschiedliche Ursachen. Die Anwendung darf einen technischen Abbruch nicht dem Menschen zuschreiben. Der gespeicherte Testfall bleibt auch nach einer Unterbrechung erhalten.

## Zustände und Nachweise

| Zustand | Nächste Handlung |
| --- | --- |
| Ein Auftrag läuft | Fortschritt ansehen oder abbrechen |
| Lokale fachliche Änderungen | Speichern und erneut fachlich prüfen |
| Offene Frage oder ungültiger fachlicher Ablauf | Die betroffene Angabe klären |
| Gültiger Ablauf ohne aktuelle Freigabe | Fachlich freigeben |
| Freigegeben, aber noch nicht ausgeführt | Technik vorbereiten und Probelauf starten |
| Wiederverwendung oder Erweiterung vorgeschlagen | Den konkreten Vergleich beurteilen |
| Zugeordneter Browserlauf fehlgeschlagen | Den fehlgeschlagenen Schritt prüfen |
| Zugeordneter Browserlauf bestanden | Ergebnis ansehen; Wiederverwendung optional prüfen |

Ein Ergebnis gehört zu einem konkreten Auftrag und dessen Fachstand. Ein alter grüner Lauf darf nicht als Ergebnis eines neueren, noch unvollständigen Auftrags erscheinen. Nach einer fachlichen Änderung bleiben ältere Nachweise in der Historie, gelten aber nicht als Nachweis für die Änderung.

## Wissen entsteht während der Arbeit

Vorhandenes Wissen wird zuerst ausgewertet. Reicht es nicht aus, kann die KI die aktuelle Portaloberfläche in einer separaten lokalen Umgebung erkunden. Beobachtungen aus dieser Erkundung belegen, was die Oberfläche tatsächlich zeigt und welche Eingaben möglich waren. Sie ersetzen keine fachliche Bestätigung einer Versicherungsregel.

Fehlendes Wissen darf auch ein Mensch beim Definieren eines Blocks ergänzen. Die neue Wissensbeschreibung und ihre Verbindung zum Block werden gemeinsam gespeichert. Es ist nicht nötig, einen beliebigen vorhandenen Wissenseintrag auszuwählen, nur um den Dialog abschließen zu können.

## Dubletten und Versionen

Eine andere Version desselben Blocks ist keine eigenständige Dublette. Versionspflege gehört zur verwendeten Blockdefinition. Ein Dublettenvergleich untersucht dagegen andere Bausteine und erklärt, was fachlich übereinstimmt, welche Eingaben abweichen und welche Entscheidung erforderlich ist.

Weder ein Versionswechsel noch ein Vorschlag zur Wiederverwendung verändert still den freigegebenen Test. Eine fachliche Änderung braucht eine neue Prüfung. Wiederverwendungsvorschläge nach einem bestandenen Lauf sind optional; ihr Fehlschlagen macht den bestandenen Browserlauf nicht rückwirkend ungültig.
