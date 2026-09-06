# Technische Anbindung des Portals

Maßgeblicher Portalvertrag: docs/agriculture-api.md. Typen: shared/agriculture.ts. Die Portalrouten beginnen mit /portal, APIs mit /api/agriculture. Die genaue UI-Interaktion wird in versionierten technischen Bindungen und deren Rezepten hinterlegt.

## Vorgehen für die technische Phase

Für jeden elementaren Block: vollständiges Eingabeschema lesen, den passenden sichtbaren Portalweg bestimmen, alle Werte setzen oder explizit prüfen und reale Ergebnisreferenzen erfassen. Parent-Referenzen wie customerId und farmId müssen gegen die Antwort geprüft werden. Fehlende Felder bleiben eine technische Lücke.

Jeder Locator besitzt einen stabilen Schlüssel. Eine Button-Umbenennung ändert die kleinste betroffene technische Bindung. Die fachliche Definition bleibt unverändert. Der Änderungsfolgen-Graph zeigt direkte und verschachtelte Verwendungen. Ein neuer Lauf friert die gewählte Bindungsrevision ein; bestehende Laufbelege bleiben unverändert.

Browseraktionen müssen ausschließlich die lokale Portal-Anwendung bedienen. Ein künstlich erzeugtes Erfolgsergebnis ersetzt keine beobachtete Portalaktion.
