---
id: "rule:location-eligibility"
kind: "rule"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: applies-to
    target: concept:insured-location
  - relation: preserves
    target: concept:issuing-market
---

# Location eligibility and address consistency

For Meridian Commercial Property v3, the issuing market is DE and currency is EUR. Insured locations may be DE or IT. Headquarters remains DE for the standard fixture.

An IT Warehouse uses Via delle Officine 24, Milan, 20126. A DE Warehouse uses Hafenstrasse 42, Hamburg, 20457. An IT Factory uses Via della Produzione 8, Turin, 10156. A DE Factory uses Werkstrasse 18, Stuttgart, 70327.

A country override applies to the named risk location and replaces that location's full address. It does not change headquarters, market or other risks. Two explicit modifiers that disagree on the same resolved field are an authoring conflict. A modifier may override a template default.

These are fictional product rules.
