# Kunde und Betrieb

Der Kunde ist der Versicherungsnehmer. Der Betrieb ist die konkrete Tierhaltung mit eigener Adresse, Betriebsart und Bundesland. Ein Kunde kann mehrere Betriebe haben. Ein Tier gehört genau einem Betrieb. Ein Vorschlag verbindet einen Kunden, genau einen seiner Betriebe und Tiere dieses Betriebs.

## Erforderliche Daten

Beim Kunden: name, email, phone, street, postalCode, city. Beim Betrieb: customerId, name, state, street, postalCode, city, farmType. customerId ist die Referenz auf den zuvor angelegten oder ausgewählten Kunden.

## Standard und Ausnahme

Der Standardbetrieb liegt in Niedersachsen, Hofweg 8, 29525 Uelzen. Ein Wunsch „Betrieb in Bayern“ ändert die Daten dieser einen Betriebsverwendung. Ein stimmiges Demo-Beispiel ist Bayern, Dorfstraße 12, 87437 Kempten. Zeige alle geänderten Betriebsfelder zur Prüfung. Die Kundenadresse wird dadurch nicht automatisch geändert. Für Rinder gilt in Bayern eine Direktionsgrenze von 11.000 EUR statt 10.000 EUR; die übrigen Grenzen bleiben gleich.

Die Referenzen auf Kunde, Betrieb und Tier müssen zusammenpassen. Ein Vorschlag darf kein Tier eines anderen Betriebs versichern.
