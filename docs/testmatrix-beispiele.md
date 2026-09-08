# Beispiele für Anforderungen und Testmatrizen

Diese beiden Texte können im Teststudio in Schritt 1 unter „Deine Anforderung“ eingefügt werden. Der erste Text beschreibt einen einzelnen End-to-End-Test mit einem konkreten Prüfziel. Der zweite beschreibt denselben fachlichen Ablauf als parametrisierten Lauf.

## 1. Einzelner End-to-End-Test: Direktionsanfrage

> Erstelle einen normalen End-to-End-Test für eine Kuhlebensversicherung. Lege einen Kunden, einen Betrieb in Bayern und die Kuh Berta mit einer Versicherungssumme von 15.000 Euro an. Berechne das Angebot und reiche den Antrag ein. Prüfe als fachliche Assertions, dass der gespeicherte Betrieb das Bundesland Bayern enthält, dass der Vorschlag danach den Status „Direktionsprüfung“ hat und dass eine offene Direktionsanfrage sichtbar ist. Beende den Test nach diesen Prüfungen; die Direktionsentscheidung und der Vertragsabschluss gehören nicht zu diesem Testziel.

Die Assertion ist hier das fachliche Ergebnis des Laufs: Eine Rinderversicherung über 10.000 EUR erzeugt eine Direktionsanfrage. Die 15.000 EUR liegen eindeutig über dieser Grenze. Das Bundesland Bayern prüft zusätzlich, dass die Betriebsdaten durch den Ablauf erhalten bleiben; es ändert die fiktive Direktionsgrenze nicht.

## 2. Parametrisierter End-to-End-Test: Versicherungssumme und Betriebsstandort

> Erstelle einen parametrisierten End-to-End-Test für eine Kuhlebensversicherung. Verwende für jede Zeile der folgenden Testmatrix denselben Ablauf: Kunde anlegen, Betrieb mit dem Matrixwert für `Bundesland` anlegen, dieselbe Kuh Alma mit ihren festen Pflichtangaben anlegen, den Matrixwert für `Versicherungssumme` setzen, Angebot berechnen und Antrag einreichen. Die Matrix hat drei Spalten: `Bundesland` und `Versicherungssumme` sind variable Eingabefelder; `Erwarteter Status` ist ein explizites Assertionfeld und darf nicht aus dem beobachteten Ergebnis abgeleitet oder nachträglich überschrieben werden. Prüfe pro Lauf als Assertions, dass das gespeicherte Bundesland dem Matrixwert entspricht und dass der Vorschlagsstatus exakt dem Wert aus `Erwarteter Status` entspricht. Schließe keinen Vertrag ab. Jeder Lauf muss eigene Testdaten und eine eigene Vorschlagsreferenz verwenden.
>
> ```text
> Bundesland      | Versicherungssumme | Erwarteter Status
> Niedersachsen   | 10.000 EUR         | Freigegeben
> Niedersachsen   | 10.001 EUR         | Direktionsprüfung
> Bayern          | 10.000 EUR         | Freigegeben
> Bayern          | 10.001 EUR         | Direktionsprüfung
> ```

Die beiden Beträge prüfen die Grenze selbst und knapp darüber. Die beiden Bundesländer prüfen, dass der Standort als Eingabe variiert und gespeichert wird, ohne die Annahmeregel ungewollt zu verändern. Der erwartete Status ist pro Zeile Teil der Testdefinition und damit die Prüfvorlage; ein Lauf darf ihn nicht aus seinem tatsächlichen Ergebnis berechnen. Für einen konkreten 100-Zeilen-Lauf kann die UI zehn tatsächlich angebotene Bundesländer (zum Beispiel Baden-Württemberg, Bayern, Berlin, Brandenburg, Bremen, Hamburg, Hessen, Mecklenburg-Vorpommern, Niedersachsen und Nordrhein-Westfalen) mit den zehn Summenwerten 10.001, 11.000, 12.000, 13.000, 14.000, 15.000, 16.000, 17.000, 18.000 und 19.000 EUR kombinieren. Alle 100 Zeilen erhalten dabei den expliziten erwarteten Status `Direktionsprüfung`; es entstehen 100 Testdatenzeilen, nicht 100 Kopien des Scratch-Ablaufs. Die kleine Vierzeilenmatrix oben bleibt der Grenzfallnachweis.

## Bedienung der Matrix im Teststudio

Nach dem fachlichen Ablauf wird die optionale Matrix über den Schalter „Mit Testdaten variieren“ aktiviert. Beim ersten Öffnen sind noch keine Testfallzeilen erzeugt; die Vorschau zählt die möglichen Kombinationen aus den eingetragenen Werten.

1. Klicke „Erste Spalte hinzufügen“. Wähle im Feld „Feld im Ablauf“ das Eingabefeld für `Bundesland` und trage unter „Werte für Kombinationen“ je einen Bundeslandwert in eine eigene Zeile ein.
2. Klicke „Spalte hinzufügen“. Wähle das Eingabefeld für `Versicherungssumme` und trage die zehn Summenwerte ein. Die Vorschau muss jetzt 100 Kombinationen anzeigen.
3. Füge eine weitere Spalte hinzu und wähle im „Feld im Ablauf“ das Feld `Erwarteter Zustand` aus dem vorhandenen Status-Prüfblock. Trage unter „Werte für Kombinationen“ für den beschriebenen 100-Zeilen-Lauf nur den einen Wert `Direktionsprüfung` ein. Dieser einzelne Wert gilt als Erwartung für jede Kombination; er erzeugt keine weiteren Kombinationen.
4. Klicke „Kombinationen erzeugen“. Die Tabelle enthält danach höchstens 100 Zeilen. Mit „Ausführen“ werden einzelne Zeilen ein- oder ausgeschlossen; die Ausführung startet über den normalen Lauf des Testfalls.

Das Ergebnis zeigt für eine Matrix den Text „Alle Testfälle sind bestanden“ oder die Anzahl im Format „x von y Testfällen bestanden“. Bei einer Abweichung öffnet die betroffene Zeile die ausgeführten Schritte und den konkreten Fehler. Die vier kleinen Beispielzeilen können entweder als manuelle Zeilen gepflegt oder über je zwei Werte für `Bundesland` und `Versicherungssumme` erzeugt werden. Setze anschließend die erwarteten Statuswerte entsprechend der Beispieltabelle. Die 100-Zeilen-Variante ist ein separater Generatorlauf. Eine Matrix unterstützt höchstens 20 Spalten.

## Warum die Matrix nicht „Bundesland und Alter der Kuh“ verwendet

Das Geburtsdatum ist für ein Rind ein Pflichtfeld und eignet sich als variable Eingabe. In der derzeitigen fiktiven Produktregel gibt es aber keine Altersgrenze und keinen altersabhängigen erwarteten Status. Eine Altersmatrix würde deshalb nur prüfen, dass unterschiedliche Geburtsdaten gespeichert werden, ohne eine fachliche Kombination zu unterscheiden. Die Versicherungssumme ist dagegen bereits mit einer nachweisbaren Grenzregel verbunden.

Sobald eine Altersregel fachlich dokumentiert ist, kann `Geburtsdatum` oder ein daraus berechnetes `Alter` die zweite Matrixspalte ersetzen oder ergänzen. Die Regel braucht dann eine klare Grenze und ein erwartetes Ergebnis je Bereich, damit die Matrix eine echte Assertion besitzt.

Die zugrunde liegenden Produktdaten stehen in [fach.kunde-betrieb.md](../knowledge/agriculture/fach.kunde-betrieb.md), [fach.tierarten.md](../knowledge/agriculture/fach.tierarten.md) und [regel.direktionsanfrage.md](../knowledge/agriculture/regel.direktionsanfrage.md). Die dort beschriebene Grenze gilt strikt: Genau 10.000 EUR lösen keine Direktionsanfrage aus, 10.001 EUR schon.
