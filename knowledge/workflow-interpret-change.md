---
id: "workflow:interpret-change"
kind: "workflow"
owner: "property-domain-team"
appliesTo: "meridian-commercial-property-v3"
revision: "knowledge-1"
links:
  - relation: resolves-with
    target: rule:location-eligibility
  - relation: preserves
    target: concept:issuing-market
---

# Interpret and confirm a change

The prototype uses a deterministic local vocabulary, not an LLM service. Supported location requests include moving this location to Italy or Germany, setting sum insured to an explicit amount, and setting Flood coverage to an explicit limit. EUR, €, m, million, k and thousand amount forms are supported.

The preview stores the author's exact text, target location, template version and content fingerprint, resolved changes, preserved fields and knowledge revision. Confirmation stores a decision ID. Changing text, location scope, relevant inputs or template invalidates the confirmation.

Ambiguous requests such as Increase the coverage do not execute. Unsupported countries and multiple contradictory values produce a focused authoring error. The executable scenario uses the confirmed structured changes rather than reinterpreting prose on every run.
