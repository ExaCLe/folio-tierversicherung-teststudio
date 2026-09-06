---
id: "workflow:amend-policy"
kind: "workflow"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: reuses
    target: workflow:issue-policy
  - relation: constrained-by
    target: rule:flood-referral
---

# Amend an issued policy

The amendment scenario invokes the pinned Issue referred property policy workflow to create its own starting policy. It does not depend on another test having run.

The Senior underwriter raises Warehouse sum insured from EUR 1,500,000 to EUR 2,000,000 on the first day of the second policy month. This prototype records previous values and premium, updates the Fire limit to match the new declared value, re-rates the policy and increments its version to 2.

Increasing sum insured on a location with referred Flood exposure requires Senior underwriter. The existing suitable Warehouse survey supports this amendment. New referral exposure also requires senior review and suitable evidence. These are fictional product rules.
