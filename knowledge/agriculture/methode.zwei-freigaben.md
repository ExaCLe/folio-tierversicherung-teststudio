# Vom Wunsch zum geprüften Testfall

Die Eingabe ist ein Testziel in deutscher Alltagssprache. Beispiel: „Eine Kuh für 15.000 Euro soll eine Direktionsanfrage auslösen.“ Der fachliche Agent sucht dazu Regeln, erforderliche Daten und vorhandene Blockdefinitionen. Er gibt strukturierte Blöcke, verwendete Wissens-IDs, Annahmen und offene Fragen aus.

## Fachliche Phase

1. Bestimme Kunde, Betrieb, Tierart, Versicherungssumme und das erwartete Ergebnis. Fehlende Werte erhalten ausdrücklich sichtbare Annahmen.
2. Lies bei Kunden- oder Betriebsdaten fach.kunde-betrieb, bei Tierdaten fach.tierarten, bei hoher Summe regel.direktionsanfrage und beim Policendruck ablauf.policendruck.
3. Suche Definitionen anhand der Bedeutung, Eingaben, Vorbedingungen und Ergebnisse. Nutze einen vorhandenen zusammengesetzten Block nur, wenn sein Endzustand zum Ziel passt.
4. Fehlt eine elementare Fähigkeit, entwirf eine neue Definition samt passendem Wissensdokument. Markiere technische Umsetzung als offen. Ein fehlender Block ist ein sichtbares Ergebnis, kein erfundener Testerfolg.
5. Liefere den vollständigen fachlichen Ablauf mit typisierten Werten. Die Phase ist abgeschlossen, wenn jeder Schritt und jede Annahme für den Menschen prüfbar sind.

Die menschliche Freigabe gilt genau für die aktuelle Szenariorevision, die enthaltenen Definitionsversionen und die relevanten Wissensrevisionen. Eine lokale Wertänderung oder neue fachliche Definition verlangt erneute Freigabe. Verschieben und Zoomen ändern die Freigabe nicht.

## Technische Phase

Lies technik.portal und die zugehörigen Bindungen erst nach der Fachfreigabe. Prüfe für jeden elementaren Block sämtliche Eingaben, konkrete UI-Interaktionen, Vorbedingungen und beobachtbare Ergebnisse. Prüfe gesondert auf fachlich gleichwertige vorhandene Definitionen. Eine Umstrukturierung der Fachlogik führt zurück zur Fachprüfung.

Ein Browserlauf gilt nur dann als bestanden, wenn die realen Portalaktionen und Erwartungen bestanden sind. Aus einem erfolgreichen Lauf darf der Agent Vorschläge zur Wiederverwendung ableiten. Der Mensch entscheidet über deren Aufnahme in die Bibliothek.
