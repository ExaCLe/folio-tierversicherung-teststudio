# Historischer Demoguide der Sachversicherung

Dieser Text beschreibt die abgelöste englische Oberfläche. Die aktuelle Anleitung für Tierversicherung und Teststudio steht im [deutschen Demoguide](../demo-walkthrough.md). Die folgenden Schritte gehören ausschließlich zum historischen Vorgänger.

# A first session with Folio

Folio puts an insurance workbench beside a small language for testing it. The business example is fictional commercial property insurance. The manufacturer has a factory in Germany and a warehouse that can move to Italy. In this product, a flood limit above EUR 500,000 at any location needs a senior underwriter and a suitable survey for that location.

The interesting part of the example is the connection between a business sentence, a saved block, a maintained browser helper, and the evidence from a real run.

## Walk through the insurance work first

Open the insurance desk and choose **New policy**. The wizard takes you through the customer, product and term, locations and risks, coverages, declarations and billing, and a review. Each location has its own address, construction, insured value, and coverages.

Keep the factory in Germany. Give the warehouse an Italian address and add flood coverage with a limit of EUR 1,000,000. Save the draft. This saves a draft only; it does not request or approve a quote.

Request a quote. The quote refers because the warehouse exceeds the broker's flood authority. Switch the acting role to **Senior underwriter**, attach a suitable risk survey to the warehouse, and approve that exact referral. Switch back to **Broker** and issue the policy. Open the policy schedule to check the warehouse country, flood limit, and issued version.

The application also records premium components, documents, quote references, and activity. Editing a draft after quoting invalidates the old quote. An issued policy changes through an amendment, which preserves its previous values and creates a new policy version.

## Read the same work as blocks

Open the Studio and inspect the referred multi-location scenario. The sequence describes the business work:

1. As Broker, create a standard draft with a warehouse variation.
2. Request a quote and expect a referral.
3. As Senior underwriter, attach the warehouse survey and approve the quote.
4. As Broker, issue the policy and verify the schedule.

A role container changes who performs its child actions. A location modifier changes the configuration used to create a draft. These have different meanings even though both appear nested. Configuration resolves before the browser starts creating the policy.

Select a block and inspect its inputs and references. The template supplies explicit defaults. A scenario supplies only its changes. The resolved configuration shows the result before execution.

## Try a sentence with a precise scope

Use a free-text modifier under the warehouse and enter `This location should be in Italy instead of Germany`. Interpret it, inspect the proposed changes, and confirm them. The preview should identify the warehouse risk-location country and its synthetic Italian address. The customer headquarters, issuing market, and factory are separate fields.

The saved record contains the original sentence and the confirmed structured interpretation. Execution uses the structured changes. It does not ask a language model to reinterpret the sentence on each run.

Edit the sentence after confirmation. The old confirmation becomes invalid. A change to the scope or source template also needs a new review. Try `Increase the coverage` to see how an unresolved instruction differs from an executable modifier. Try two explicit modifiers with different values for the same field to see a conflict.

This prototype uses a small deterministic vocabulary for interpretation. It demonstrates the review lifecycle and storage format without a paid API or a language model service.

## Run and inspect the evidence

Run the valid scenario. The runner launches an isolated Chromium context and performs the business actions through the insurance UI. Each actionable block gets its own result and screenshot. Logical references such as `policy` and `quoteRequest` bind to the IDs created in that run. Changing roles does not change those references.

Inspect the generated source, resolved data, step results, and trace. A failed action stops dependent actions and records a useful failure at the originating block. A normal approval as Broker is invalid authoring, but an explicit attempt followed by an expectation of access denied is a supported negative test.

The run has a snapshot of the scenario revision, block versions, implementation revisions, and resolved values. A later edit does not rewrite old evidence.

## Turn a working sequence into a reusable workflow

Save the useful issuance sequence as a workflow. Expose the country, flood limit, and sum insured as parameters where they vary. Keep stable defaults in the shared definition. A second scenario can use that definition with a different limit instead of copying the entire sequence.

The shared definition and its use in a scenario are separate records. A scenario pins a workflow version. Publishing a newer version leaves the older scenario and its historical runs intact. Local overrides affect one use of the workflow.

Now open the amendment example. It begins by invoking issuance for itself, then increases the warehouse sum insured and checks the new policy version. It does not depend on another scenario having run first.

## Inspect what is stored

The storage inspector makes the connections visible. Follow a scenario instance to its versioned definition, then to the implementation and knowledge references. A template stores defaults; a modifier stores a scoped change; an interpretation stores a review decision; a run stores the exact build and resulting IDs.

The canonical scenario remains readable without the editor. Presentation state is separate, so moving a block on screen does not alter its business meaning. The graph is a projection of explicit IDs and relationships. It does not require a graph database.

When adding a new capability, define its meaning and types, link the relevant knowledge, implement its browser helper, and add a focused acceptance test. A new scenario should mostly compose those existing parts.
