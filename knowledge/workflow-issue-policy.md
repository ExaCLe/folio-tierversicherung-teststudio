---
id: "workflow:issue-policy"
kind: "workflow"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: follows
    target: workflow:approve-referral
  - relation: verifies
    target: concept:insured-location
---

# Issue and verify a policy

Issuance consumes the exact quote and policy reference. The Broker confirms issuance after either a straight-through quoted result or senior-underwriter approval. A referred quote cannot issue without approval.

The resulting schedule shows both insured locations, customer, issuing market, coverage limits, premium and version. The seed Italy scenario verifies Warehouse in Italy with EUR 1,000,000 Flood coverage while headquarters, issuing market and Factory stay German.
