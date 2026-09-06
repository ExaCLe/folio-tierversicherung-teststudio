---
id: "rule:approval-authority"
kind: "rule"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: governs
    target: workflow:approve-referral
  - relation: supports-negative-test
    target: block:quote.attempt-broker-approval
---

# Approval authority

Only Senior underwriter can approve a referred quote. Broker remains unable to approve even when a survey exists. The application checks authority on the backend as well as in the interface.

The ordinary Approve referral block requires Senior underwriter. Attempt approval as broker is a distinct negative-test operation. Its output is an approval attempt, not an approved quote. Expect access denied consumes that attempt and verifies the rejected action and unchanged referred status.

The negative test deliberately exercises an unauthorized request initiated through the UI.
