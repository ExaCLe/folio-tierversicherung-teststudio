# Vom Entwurf zum Antrag

Ein Vorschlag braucht customerId, farmId, animalIds, product, startDate und durationMonths=12. Rind, Pferd und Hund verwenden Tierlebensversicherung. Schweine verwenden Bestandsversicherung.

1. Kunde anlegen oder auswählen.
2. Einen Betrieb des Kunden anlegen oder auswählen.
3. Mindestens ein passendes Tier dieses Betriebs erfassen.
4. Vorschlag speichern. Ergebnis ist Entwurf.
5. Angebot berechnen. Ergebnis ist Angebot mit Jahresbeitrag.
6. Antrag einreichen. Ergebnis ist Freigegeben oder Direktionsprüfung.

Für einen Test, der nur einen Entwurf braucht, genügen die ersten vier Schritte. Für eine Direktionsanfrage braucht es zusätzlich Berechnung und Einreichung. Kein wiederverwendbarer Block sollte einen späteren Zustand erzwingen, den der Test nicht benötigt.
