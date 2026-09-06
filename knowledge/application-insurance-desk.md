---
id: "application:insurance-desk"
kind: "application"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: implements
    target: workflow:create-draft
  - relation: implements
    target: workflow:approve-referral
  - relation: implements
    target: workflow:issue-policy
---

# Insurance desk mapping

The six wizard steps are Customer, Product & term, Locations & risks, Coverages, Declarations & billing, and Review. A named role control selects Broker or Senior underwriter.

The maintained Playwright driver is e2e/helpers/insurance-driver.ts. It uses accessible labels, exact policy and quote IDs, and business steps. Each run records browser screenshots, a Playwright trace, resolved object references and the exact compiled scenario.

Changing a locator changes the implementation revision. Changing what an operation means requires a new block definition version.
