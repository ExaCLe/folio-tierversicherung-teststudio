---
id: "concept:insured-location"
kind: "concept"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: distinct-from
    target: concept:issuing-market
  - relation: constrained-by
    target: rule:location-eligibility
---

# Insured location

Factory and Warehouse are separate insured locations under the same policy. A location country is the country of the physical risk. It is independent of the customer's headquarters country and the policy's issuing market.

The standard Factory is in Stuttgart, Germany. The standard Warehouse is in Hamburg, Germany. A country change selects a complete synthetic address in the target country. Sum insured is the declared value at one location. Changing it also updates that location's Fire limit in this prototype.

Location IDs are scoped to one policy. Warehouse on policy A cannot satisfy a document requirement on policy B.
