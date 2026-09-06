---
id: "workflow:approve-referral"
kind: "workflow"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: constrained-by
    target: rule:flood-referral
  - relation: requires
    target: rule:approval-authority
  - relation: uses-evidence
    target: fixture:risk-survey
---

# Approve a referred quote

The scenario retains explicit logical references to the draft policy, Warehouse and quote request. Senior underwriter attaches the approved synthetic survey to Warehouse on that policy, then approves that exact quote.

The policy revision must still match the quote snapshot. Every location with a Flood limit above the threshold needs suitable evidence. Approval creates an approval output that references the same quote request.
