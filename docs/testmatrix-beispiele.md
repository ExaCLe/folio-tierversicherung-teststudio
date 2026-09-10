# Beispiele für Anforderungen und Testmatrizen

Diese beiden Texte können im Teststudio in Schritt 1 unter „Deine Anforderung“ eingefügt werden. Der erste Text beschreibt einen einzelnen End-to-End-Test mit einem konkreten Prüfziel. Der zweite beschreibt denselben fachlichen Ablauf als parametrisierten Lauf.

## 1. Einzelner End-to-End-Test: Direktionsanfrage

> Erstelle einen normalen End-to-End-Test für eine Kuhlebensversicherung. Lege einen Kunden, einen Betrieb in Bayern und die Kuh Berta mit einer Versicherungssumme von 15.000 Euro an. Berechne das Angebot und reiche den Antrag ein. Prüfe als fachliche Assertions, dass der gespeicherte Betrieb das Bundesland Bayern enthält, dass der Vorschlag danach den Status „Direktionsprüfung“ hat und dass eine offene Direktionsanfrage sichtbar ist. Beende den Test nach diesen Prüfungen; die Direktionsentscheidung und der Vertragsabschluss gehören nicht zu diesem Testziel.

Die Assertion ist hier das fachliche Ergebnis des Laufs: Eine Rinderversicherung in Bayern über 11.000 EUR erzeugt eine Direktionsanfrage. Die 15.000 EUR liegen eindeutig über dieser Grenze. Das Bundesland ist Teil der Annahmeregel und muss durch den Ablauf erhalten bleiben.

## 2. Parametrisierter End-to-End-Test: Versicherungssumme und Betriebsstandort

> Erstelle einen parametrisierten End-to-End-Test für eine Kuhlebensversicherung. Verwende für jede Zeile der folgenden Testmatrix denselben Ablauf: Kunde anlegen, Betrieb mit dem Matrixwert für `Bundesland` anlegen, dieselbe Kuh Alma mit ihren festen Pflichtangaben anlegen, den Matrixwert für `Versicherungssumme` setzen, Angebot berechnen und Antrag einreichen. Die Matrix hat drei Spalten: `Bundesland` und `Versicherungssumme` sind variable Eingabefelder; `Erwarteter Status` ist ein explizites Assertionfeld und darf nicht aus dem beobachteten Ergebnis abgeleitet oder nachträglich überschrieben werden. Prüfe pro Lauf als Assertions, dass das gespeicherte Bundesland dem Matrixwert entspricht und dass der Vorschlagsstatus exakt dem Wert aus `Erwarteter Status` entspricht. Schließe keinen Vertrag ab. Jeder Lauf muss eigene Testdaten und eine eigene Vorschlagsreferenz verwenden.
>
> ```text
> Bundesland | Versicherungssumme | Erwarteter Status
> Bayern     | 10.000 EUR          | Freigegeben
> Bayern     | 11.000 EUR          | Freigegeben
> Bayern     | 12.000 EUR          | Direktionsprüfung
> Hessen     | 10.000 EUR          | Freigegeben
> Hessen     | 11.000 EUR          | Direktionsprüfung
> Hessen     | 12.000 EUR          | Direktionsprüfung
> ```

Die Zeilen prüfen die bayerische Sondergrenze und die niedrigere Grenze in Hessen. Der erwartete Status ist pro Zeile Teil der Testdefinition und damit die Prüfvorlage. Ein Lauf darf ihn nicht aus seinem tatsächlichen Ergebnis berechnen oder nachträglich überschreiben.

## Bedienung der Matrix im Teststudio

Nach dem fachlichen Ablauf wird die optionale Matrix über den Schalter „Mit Testdaten variieren“ aktiviert. Jede Tabellenzeile beschreibt genau einen Testlauf. Die Werte derselben Zeile bleiben gekoppelt.

1. Klicke „Erste Eingabe hinzufügen“ und wähle `Bundesland` aus dem Vorbereitungsblock. Wähle Bayern und ergänze mit „Weiteren Wert“ Hessen.
2. Klicke „Eingabe hinzufügen“, wähle `Versicherungssumme` aus demselben Block und trage 10.000, 11.000 und 12.000 EUR als einzelne Werte ein. Die Vorschau zeigt sechs Kombinationen.
3. Klicke „Erwartetes Ergebnis hinzufügen“ und wähle `Erwarteter Zustand` aus dem Status-Prüfblock. Erzeuge die Kombinationen und übertrage anschließend die sechs Sollwerte aus der Tabelle oben zeilenweise. Geldbeträge werden als Geldwerte gespeichert, Bundesland und Status als erlaubte Auswahlwerte.
4. Speichere den Testfall und lade ihn neu. Prüfe vor dem Lauf, dass die sechs Kombinationen unverändert angezeigt werden. Mit „Ausführen“ lassen sich einzelne Zeilen ein- oder ausschließen.

Das Ergebnis zeigt für eine Matrix den Text „Alle Testfälle sind bestanden“ oder die Anzahl im Format „x von y Testfällen bestanden“. Bei einer Abweichung öffnet die betroffene Zeile die ausgeführten Schritte und den konkreten Fehler. Eine Matrix unterstützt höchstens 20 Spalten und 100 Zeilen.

## Warum die Matrix nicht „Bundesland und Alter der Kuh“ verwendet

Das Geburtsdatum ist für ein Rind ein Pflichtfeld und eignet sich als variable Eingabe. In der derzeitigen fiktiven Produktregel gibt es aber keine Altersgrenze und keinen altersabhängigen erwarteten Status. Eine Altersmatrix würde deshalb nur prüfen, dass unterschiedliche Geburtsdaten gespeichert werden, ohne eine fachliche Kombination zu unterscheiden. Die Versicherungssumme ist dagegen bereits mit einer nachweisbaren Grenzregel verbunden.

Sobald eine Altersregel fachlich dokumentiert ist, kann `Geburtsdatum` oder ein daraus berechnetes `Alter` die zweite Matrixspalte ersetzen oder ergänzen. Die Regel braucht dann eine klare Grenze und ein erwartetes Ergebnis je Bereich, damit die Matrix eine echte Assertion besitzt.

Die zugrunde liegenden Produktdaten stehen in [fach.kunde-betrieb.md](../knowledge/agriculture/fach.kunde-betrieb.md), [fach.tierarten.md](../knowledge/agriculture/fach.tierarten.md) und [regel.direktionsanfrage.md](../knowledge/agriculture/regel.direktionsanfrage.md). Die dort beschriebenen Grenzen gelten strikt: Außerhalb Bayerns lösen 10.001 EUR eine Direktionsanfrage aus, in Bayern erst 11.001 EUR.
