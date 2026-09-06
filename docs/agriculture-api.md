# Tierversicherung: Vertrag für Portal und Browserabläufe

Fiktive Tierversicherung „Land & Tier“. Neue Daten liegen ausschließlich in `agriculture.*`-Kollektionen. Bestehende Versicherungs- und Studiokollektionen bleiben erhalten. Die maßgeblichen Typen stehen in `shared/agriculture.ts`.

## Rollen und fachliche Regeln

Jede schreibende Anfrage trägt `x-agriculture-role`: `Vermittler`, `Direktion` oder `Sachbearbeiter`. Fehlende Rolle bedeutet Vermittler; unbekannte Rollen werden abgewiesen. Vermittler erfassen Kunde, Betrieb, Tier und Vorschlag, berechnen Angebote, reichen Anträge ein und schließen freigegebene Vorschläge ab. Nur die Direktion entscheidet über Direktionsanfragen. Nur Sachbearbeiter geben bestehende Policen erneut aus und erfassen Druckaufträge. Dies ist eine lokale Rollenwahl für das fiktive System.

Ein Kunde kann mehrere Betriebe besitzen. Ein Tier oder Schweinebestand gehört genau einem Betrieb. Ein Vorschlag darf nur Tiere desselben Betriebs und desselben Kunden enthalten. Tierlebensversicherung gilt für Rind, Pferd oder Hund. Bestandsversicherung gilt für Schweinebestände. Die Laufzeit beträgt zwölf Monate. Eine Direktionsanfrage ist erforderlich, wenn die Versicherungssumme eines Rinds 10.000 EUR, eines Pferds 50.000 EUR, eines Hunds 10.000 EUR oder eines Schweinebestands 500.000 EUR **übersteigt**. Der jeweilige Grenzwert selbst löst keine Anfrage aus. Pferde mit Vorerkrankung und Schweinebestände mit ungeklärter Biosicherheit benötigen ebenfalls eine Entscheidung. Bundesländer ändern diese Regeln nicht.

Jahresbeitrag = Summe der Versicherungssummen multipliziert mit dem Tierartbeitrag: Rind 3,5 %, Pferd 4 %, Hund 5 %, Schwein 1,8 %. Mindestbeitrag je Vorschlag 60 EUR. Alle Regeln und Beträge sind fiktiv.

## Endpunkte unter `/api/agriculture`

Antworten mit einem Objekt nutzen die benannte Hülle, etwa `{ customer }`. Fehler enthalten `{ error, code }`, lesbaren deutschen Text sowie HTTP 400, 403, 404 oder 409.

| Methode und Pfad | Eingabe | Antwort |
| --- | --- | --- |
| GET `/meta` | | `{ roles, rules, federalStates, species }` |
| GET `/overview` | optional `runId` | `AgricultureOverview` |
| GET `/customers` | | `{ customers }` |
| POST `/customers` | `AgricultureCustomerInput` | 201 `{ customer }` |
| GET `/farms?customerId=…` | | `{ farms }` |
| POST `/farms` | `FarmInput` | 201 `{ farm }` |
| GET `/animals?farmId=…` | | `{ animals }` |
| POST `/animals` | `AgricultureAnimalInput` | 201 `{ animal }` |
| POST `/proposals` | `ProposalInput` | 201 `{ proposal }`, Zustand Entwurf |
| GET `/proposals/:id` | | `ProposalDetail` |
| POST `/proposals/:id/offer` | `{}` | `{ proposal }`, Zustand Angebot |
| POST `/proposals/:id/submit` | `{}` | `{ proposal, referral }`, Freigegeben oder Direktionsprüfung |
| POST `/referrals/:id/decision` | `{ decision: 'Freigeben' \| 'Ablehnen', reason: string }` | `{ proposal, referral }` |
| POST `/proposals/:id/complete` | `{}` | `{ proposal, contract, policy, document }` |
| GET `/policies/:id` | | `AgriculturePolicyDetail` |
| POST `/policies/:id/reissue` | `{ reason: string }` | `{ policy, document }`, neue Dokumentversion |
| POST `/policies/:id/print` | `{ documentId: string }` | `{ policy, document, printEvent }` |
| GET `/documents/:id` | | `{ document }` |
| GET `/documents/:id/html` | | vollständiges HTML-Dokument |

Abschluss ist ausschließlich im Zustand Freigegeben zulässig. Eine Direktionsentscheidung muss zum offenen Antrag gehören. Bei Ablehnung ist kein Abschluss möglich. Ein wiederholter Abschluss erzeugt keinen zweiten Vertrag, sondern HTTP 409. Alte Dokumentversionen bleiben erhalten. Druckaufträge sind an die konkrete Policen-Dokumentversion und deren SHA-256 gebunden. Ein Druckauftrag weist die Anforderung nach, keinen physischen Ausdruck.

## Stabile Portalrouten und Labels

`/portal` öffnet die Übersicht. `/portal/neu` öffnet „Neuer Versicherungsvorschlag“. `/portal/vorschlaege/:id` zeigt den Vorgang. `/portal/policen/:id` öffnet anhand einer Policen-ID denselben zugehörigen Vorgang mit Ausgabe- und Druckaktionen. Die Portalrolle ist über `getByLabel('Benutzerrolle')` wählbar. Im Portal ist keine Teststudio-Navigation vorhanden.

Die Erfassung hat vier Schritte: Kunde, Betrieb, Tier / Bestand, Vorschlag. Bestehende Kunden und Betriebe sind auswählbar. Ein neuer Kunde wird über „Neuen Kunden erfassen“ eingeblendet und mit „Kunde speichern“ gespeichert. Ein Betrieb analog über „Neuen Betrieb erfassen“ und „Betrieb speichern“. Tiere werden mit „Tier speichern“ gespeichert. Der abschließende Knopf heißt „Vorschlag speichern“. Schrittwechsel erfolgen ausdrücklich über „Weiter zu Betrieb“, „Weiter zu Tier / Bestand“ und „Weiter zu Vorschlag“. Speichern selbst wechselt den Schritt nicht.

## Aktive und historische Browserprüfungen

Die aktive Playwright-Suite wählt `agriculture-*.spec.ts` und `testing-*.spec.ts`. Die neuen Portalprüfungen stehen in `e2e/agriculture-browser.spec.ts`. Die alten Dateien `insurance-browser`, `insurance-rules`, `studio-browser`, `studio-runner` und `studio-storage` bleiben als historische Prüfungen der früheren englischen Sachversicherungsoberfläche im Projekt. Sie sind kein Nachweis für das neue Portal und werden nicht als übersprungene Erfolge gezählt. Alte Domain- und Compiler-Unit-Tests bleiben für die erhaltenen älteren Backends aktiv.

| Bereich | Eindeutige zugängliche Labels |
| --- | --- |
| Kunde | Kunde auswählen; Name des Kunden; E-Mail; Telefon; Kundenstraße; Kundenpostleitzahl; Kundenort |
| Betrieb | Betrieb auswählen; Betriebsname; Bundesland; Betriebsstraße; Betriebspostleitzahl; Betriebsort; Betriebsart |
| Tier | Tierart; Name des Tiers oder Bestands; Versicherungssumme in EUR; Ohrmarke; Rasse; Geburtsdatum; Nutzung; Chipnummer; Gesundheitszustand; Gesundheitsangaben; Anzahl Schweine; Haltungsform; Biosicherheit |
| Vorschlag | Versicherungsprodukt; Versicherungsbeginn |
| Entscheidung | Entscheidung; Begründung der Entscheidung |
| Police | Grund der erneuten Ausgabe |

Detailaktionen heißen „Angebot berechnen“, „Antrag einreichen“, „Entscheidung speichern“, „Vertrag abschließen“, „Police erneut ausgeben“ und „Police drucken“. Wichtige Nachweise tragen `data-testid="proposal-status"`, `proposal-number`, `referral-number`, `contract-number`, `policy-number`, `document-version`, `print-confirmation`. Die IDs sind an `data-proposal-id`, `data-customer-id`, `data-farm-id`, `data-animal-id`, `data-referral-id`, `data-contract-id`, `data-policy-id`, `data-document-id` der jeweils zugehörigen sichtbaren Datengruppe auslesbar.

`?runId=…` in der Erfassungsroute wird in den neuen Vorschlag übernommen. GET overview mit runId filtert auf diesen Vorschlag und seine verbundenen Objekte. Demo-Beispiele: Standardkuh Alma, Fleckvieh, 3.500 EUR auf Hof Lindenkamp in Niedersachsen, Dorfstraße 12, 29525 Uelzen; Kuh mit hoher Summe 15.000 EUR; Bayern-Variante Bauernhof Sonnleitner, Dorfstraße 12, 87437 Kempten. `standardFarm()` und `bayernFarm()` geben die jeweiligen vollständigen Betriebsdaten zurück. Die Kundenanschrift ist unabhängig vom Betriebsstandort.
