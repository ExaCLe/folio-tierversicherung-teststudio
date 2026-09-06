# Einzeltier und Tierbestand

Alle Regeln in diesem Prototyp sind fiktive Produktregeln. Sie beschreiben keine reale Versicherungsberatung.

## Rind

Pflichtfelder: farmId, species=Rind, name, sumInsured, earTag, breed, birthDate, use. Nutzung ist Milchkuh, Zucht oder Mast. Eine Kuh ist fachlich ein Rind. Der Begriff „Kuhlebensversicherung“ meint hier Tierlebensversicherung für ein Rind. Standardkuh Alma: Ohrmarke DE 09 123 45678, Fleckvieh, geboren 2022-04-15, Milchkuh, 3.500 EUR.

## Pferd

Pflichtfelder: farmId, species=Pferd, name, sumInsured, chipNumber, breed, birthDate, use, health. Nutzung ist Freizeit, Zucht oder Sport. health ist Unauffällig oder Vorerkrankung. Bei Vorerkrankung sind Gesundheitsangaben erforderlich und eine Direktionsentscheidung nötig.

## Hund

Pflichtfelder: farmId, species=Hund, name, sumInsured, chipNumber, breed, birthDate, use. Nutzung ist Hofhund, Hütehund oder Privat.

## Schweinebestand

Pflichtfelder: farmId, species=Schwein, name, sumInsured, animalCount, housing, biosecurity. Die Versicherungssumme gilt für den gesamten Bestand. Haltungsform ist Stallhaltung oder Freilandhaltung. Biosicherheit ist Erfüllt oder Klärung erforderlich. Bei Klärung ist eine Direktionsentscheidung nötig. Hier ist Bestandsversicherung das passende Produkt.

Tierartabhängige Felder gehören zum strukturierten Eingabeschema. Der Agent muss sie setzen; eine Bemerkung im Beschreibungstext ersetzt keinen Wert.
