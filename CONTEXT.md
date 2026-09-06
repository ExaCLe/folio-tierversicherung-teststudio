# Tierversicherung und fachliche Testbausteine

Land & Tier ist eine fiktive Versicherung für landwirtschaftliche Tierhaltung. Die Testwerkstatt beschreibt deren Geschäftsvorgänge als bearbeitbare und wiederverwendbare Blöcke.

## Versicherungssprache

**Kunde**:
Der Versicherungsnehmer, dem ein oder mehrere Betriebe gehören. Seine Anschrift ist unabhängig von den Anschriften seiner Betriebe.
_Vermeiden_: Account, Betrieb als Synonym für Kunde

**Betrieb**:
Eine konkrete Tierhaltung mit eigener Anschrift, Bundesland und Betriebsart. Jeder Betrieb gehört genau einem Kunden.

**Einzeltier**:
Ein einzeln bezeichnetes Rind, Pferd oder ein Hund mit eigener Versicherungssumme. Es gehört genau einem Betrieb.

**Tierbestand**:
Eine gemeinsam erfasste Gruppe von Schweinen mit Anzahl, Haltungsform, Biosicherheit und einer Versicherungssumme für den gesamten Bestand.

**Kuhlebensversicherung**:
Die alltagssprachliche Bezeichnung für die Tierlebensversicherung eines Rinds.
_Vermeiden_: Q-Lebensversicherung

**Versicherungsvorschlag**:
Ein konkreter Vorgang, der Kunde, Betrieb, versicherte Tiere, Produkt, Versicherungsbeginn und Laufzeit verbindet. Sein Zustand reicht vom Entwurf bis zum Abschluss oder zur Ablehnung.
_Vermeiden_: Testentwurf, Vertrag vor dem Abschluss

**Angebot**:
Ein Versicherungsvorschlag mit berechnetem Beitrag. Er ist noch kein abgeschlossener Vertrag.

**Direktionsanfrage**:
Eine konkrete Entscheidungsvorlage zu einem eingereichten Vorschlag, der wegen seiner Risikomerkmale eine Freigabe der Direktion braucht.

**Vertrag**:
Die durch Abschluss eines freigegebenen Vorschlags entstandene aktive Versicherung.

**Police**:
Die dem Vertrag zugeordnete Versicherungsurkunde. Eine Police kann mehrere Dokumentversionen besitzen.

**Policendokument**:
Eine konkrete Ausfertigung einer Police. Eine erneute Ausgabe erzeugt eine weitere Dokumentversion.

**Druckauftrag**:
Der dokumentierte Auftrag, eine bestimmte Policendokumentversion zu drucken. Er ist kein Nachweis eines physischen Papierausdrucks.

**Vermittler**:
Die Rolle, die Daten erfasst, Angebote berechnet, Anträge einreicht und freigegebene Verträge abschließt.

**Direktion**:
Die Rolle, die offene Direktionsanfragen mit Begründung freigibt oder ablehnt.

**Sachbearbeiter**:
Die Rolle, die Policen abgeschlossener Verträge erneut ausgibt und Druckaufträge erfasst.

## Sprache der Testwerkstatt

**Testziel**:
Die Beschreibung dessen, was ein Test zeigen soll, einschließlich seines erwarteten Ergebnisses.

**Testentwurf**:
Ein vom Menschen prüfbarer fachlicher Ablauf aus Blöcken, Eingabewerten und Erwartungen.
_Vermeiden_: Versicherungsvorschlag

**Testfall**:
Ein gespeicherter fachlicher Ablauf mit eigenständiger Identität und nachvollziehbaren Revisionen.

**Blockdefinition**:
Die versionierte Beschreibung einer fachlichen Fähigkeit mit Eingaben, Ergebnissen, Vorbedingungen, Nachbedingungen und Wissensbelegen.
_Vermeiden_: Blockverwendung

**Blockverwendung**:
Ein konkreter Einsatz einer bestimmten Definitionsversion mit eigenen Eingabewerten und Ergebnisverbindungen.

**Elementarer Block**:
Eine fachlich verständliche Handlung oder Prüfung, die als kleinster Baustein technisch angebunden wird.

**Zusammengesetzter Block**:
Eine wiederverwendbare Folge anderer Blöcke mit benannten Parametern und Ergebnissen. Er kann weitere zusammengesetzte Blöcke enthalten.

**Lokale Abweichung**:
Ein für genau eine Blockverwendung geänderter Wert oder enthaltener Ablauf. Andere Verwendungen derselben Definition behalten ihre eigenen Werte.

**Rollenblock**:
Eine Gruppe von Schritten, die in der darin festgelegten Benutzerrolle ausgeführt werden.

**Fachfreigabe**:
Die menschliche Bestätigung eines bestimmten Testentwurfs einschließlich seiner Werte, Definitionsinhalte und relevanten fachlichen Wissensstände.

**Technische Bindung**:
Die getrennt versionierte Verbindung eines elementaren Blocks mit konkreten Interaktionen und Nachweisen in der Anwendung.

**Laufbeleg**:
Die Ergebnisse und Nachweise einer Ausführung mit dem dabei verwendeten fachlichen und technischen Stand.

**Wiederverwendungsvorschlag**:
Eine nach einem erfolgreichen Lauf vorgeschlagene Zusammenfassung geeigneter Schritte zu einer neuen Blockdefinition. Ihre Aufnahme in die Bibliothek ist eine menschliche Entscheidung.
