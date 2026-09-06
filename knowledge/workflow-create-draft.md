---
id: "workflow:create-draft"
kind: "workflow"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: uses-fixture
    target: fixture:standard-manufacturer
  - relation: uses-rule
    target: rule:location-eligibility
  - relation: mapped-to
    target: application:insurance-desk
---

# Create a property draft

Create standard policy completes the six-step insurance wizard. It sets up the selected synthetic manufacturer, chooses Meridian Commercial Property v3 and the term, fills Factory and Warehouse risk details, sets coverages, supplies declarations and billing, and saves the review.

The completion state is Draft. There is no quote request, premium approval or issued coverage yet. Request quote and Issue policy are separate blocks.

The template resolves all configuration before the browser enters the wizard. A location override therefore tests creating the intended risk directly.
