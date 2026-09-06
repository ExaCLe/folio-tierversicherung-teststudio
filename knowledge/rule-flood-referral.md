---
id: "rule:flood-referral"
kind: "rule"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: applies-to
    target: concept:insured-location
  - relation: requires-evidence
    target: fixture:risk-survey
  - relation: requires-role
    target: rule:approval-authority
  - relation: implemented-by
    target: block:quote.approve
---

# Flood referral

For this fictional product, a Flood limit strictly above EUR 500,000 at one insured location creates a referral. The reason is Flood limit exceeds broker authority. Exactly EUR 500,000 does not trigger referral.

The threshold applies separately to each insured location. Approval requires the Senior underwriter role and a suitable Risk survey attached to every affected location on the same policy. A Factory survey cannot satisfy a Warehouse referral.

The approving quote must be the policy's current quote and must describe the current policy revision. Editing a draft invalidates its prior quote. Issuance is a separate Broker action after approval.
