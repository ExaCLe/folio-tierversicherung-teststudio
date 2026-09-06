# Historische API der früheren Sachversicherung

Dieser Vertrag beschreibt den erhaltenen historischen Vorgänger. Seine alten UI-Routen und englischen Feldnamen gelten nicht für die aktive Anwendung. Der aktuelle Vertrag steht in [agriculture-api.md](agriculture-api.md); den Einstieg zeigt der [deutsche Demoguide](demo-walkthrough.md).

Die folgenden Angaben bleiben zur Einordnung früherer Daten und Testnachweise erhalten.

This contract is owned by the insurance task. Base URL `/api/insurance`. Amounts are EUR as numbers, dates are `YYYY-MM-DD`, timestamps are ISO strings. The product rules are fictional Meridian Commercial Property v3 rules. Canonical TypeScript types are in `shared/insurance.ts`.

Send `x-folio-role: Broker` or `x-folio-role: Senior underwriter` for mutations. Missing role defaults to Broker for the local demo. An unrecognized role fails with 400. Errors use HTTP 400, 403, 404, or 409 and `{error: string, code: string}`. All requests and responses use JSON.

## Endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/meta` | | `{product, productVersion:3, roles, floodReferralThreshold:500000}` |
| GET | `/templates/standard` | | `{template: PolicyDraftInput}` |
| GET | `/customers` | | `{customers: Customer[]}` |
| POST | `/customers` | Customer fields without id, createdAt; optional source/runId | `{customer: Customer}` |
| GET | `/policies` | optional `?status=Referred&source=run&runId=...` | `{policies: Policy[], customers: Customer[]}` |
| POST | `/policies` | `PolicyDraftInput` | 201 `{policy: Policy}` |
| GET | `/policies/:id` | | `{policy, customer, quote: Quote|null}` |
| PATCH | `/policies/:id` | partial PolicyDraftInput; arrays replace completely | `{policy}` |
| POST | `/policies/:id/quote` | `{}` | `{policy, quote}` |
| GET | `/quotes/:id` | | `{quote}` |
| GET | `/referrals` | | `{policies: Policy[], quotes: Quote[], customers: Customer[]}` |
| POST | `/policies/:id/documents` | `{type:'Risk survey',locationId:'warehouse',name:'Approved synthetic survey',suitable:true}` | 201 `{policy, document}` |
| POST | `/quotes/:id/approve` | `{policyId:'exact-policy-id',notes:'Reviewed survey'}` | `{policy, quote}` |
| POST | `/policies/:id/issue` | `{quoteId:'exact-quote-id'}` | `{policy, schedule}` |
| GET | `/policies/:id/schedule` | | `{schedule: PolicySchedule}` |
| POST | `/policies/:id/amendments` | `{effectiveDate:'2026-11-01',reason:'Updated declared values',changes:{locations:[...]}}` | `{policy, amendment, schedule}` |

`GET /health` is available at `/api/health`. All insurance mutations persist in `.local/folio.json`, or `FOLIO_DATA_FILE` when set. Other subsystem collections remain intact.

## Creation and state rules

`createStandardDraft()` from `shared/insurance.ts` gives the full default input. The standard customer id is `customer-linden`, Linden Manufacturing GmbH, headquartered in Germany. The template has named location ids `factory` and `warehouse`, both initially in Germany. The country override applies to `locations[].country`, not `customer.headquartersCountry` or `issuingMarket`. For Italy the synthetic address is `{line1:'Via delle Officine 24',city:'Milan',postcode:'20126'}`.

Creating a policy returns Draft with `quoteId:null`, `premium:null`, `version:1`, `revision:1`. Creation never requests a quote. A policy's locations have ids scoped to that policy. Coverages are arrays, for example `{type:'Flood',limit:1000000,deductible:5000}`.

Broker creates/edits drafts, requests quotes, and issues policies. Only Senior underwriter approves referrals. Any Flood limit strictly above 500000 triggers a referral for that location. Exactly 500000 does not. Each referred location needs its own suitable Risk survey. Approving requires the exact policy id, its current quote, and unchanged policy revision. Edits invalidate previous quote terms, clear premium and quoteId, and return the policy to Draft. Issued policies use the amendment endpoint.

An amendment requires an issued policy and an effective date inside the term. It increments version and revision, records previous values, changes, previous premium, re-rated premium, and audit activity. New referral exposure requires senior underwriting and suitable evidence for every affected location. Schedules reflect the current issued version.

## UI routes and accessible labels

Shell routes: `/studio`, `/library`, `/knowledge`, `/runs`, `/insurance`. Insurance routes: `/insurance/new`, `/insurance/policies/:id`. Default route is `/studio`. Role select has accessible name `Acting role` and options `Broker`, `Senior underwriter`.

Insurance desk buttons: `New policy`, `Policies`, `Underwriting queue`. Wizard uses heading `New commercial property policy`, button `Continue`, final button `Save draft`, and named steps Customer, Product & term, Locations & risks, Coverages, Declarations & billing, Review. Customer selection is `Customer`. Wizard navigation supports `Back`.

Customer creation uses `New customer`, with fields `Customer name`, `Registration number`, `Headquarters country`, `Headquarters address`, `Headquarters city`, `Headquarters postcode`, `Industry`, `Contact name`, `Contact email`, and button `Save customer`. Opening `/insurance/new?runId=...` assigns `source:'run'` and that `runId` to both customers and policies created in the wizard. This only marks provenance; creation still runs through the full UI flow.

Each location is a fieldset with legend `Factory` or `Warehouse`. Within it: `Location name`, `Location country`, `Address line`, `City`, `Postcode`, `Construction`, `Year built`, `Floor area (m²)`, `Sprinkler installed`, `Flood zone`, `Sum insured`, `Fire limit`, `Fire deductible`, `Flood coverage`, `Flood limit`, `Flood deductible`. Use the named fieldset to disambiguate location fields.

Policy detail actions: `Request quote`, `Attach risk survey`, `Approve referral`, `Issue policy`, `View schedule`, `Amend policy`. Tabs: `Overview`, `Locations`, `Coverages`, `Documents`, `Activity`. Survey dialog fields: `Survey location`, `Document name`, `Suitable risk survey`; button `Attach survey`. Approval notes field `Approval notes`; button `Confirm approval`. Issue button `Confirm issue`. Policy id is exposed as `data-testid="policy-id"`; state is `data-testid="policy-status"`; quote id as `data-testid="quote-id"`. Schedule is a dialog named `Policy schedule`, with location sections that include country and coverage limits.

Amendment dialog fields: `Amendment effective date`, `Amendment reason`, `Amendment location`, `Amended sum insured`, `Amended flood limit`; button `Save amendment`. `Edit locations` lets a broker change risk information before issuance and invalidates any current quote.

Other wizard labels are `Inception date`, `Expiry date`, `Location type`, `New location type`, `Add location`, `Add loss`, `Loss date`, `Loss amount`, `Loss description`, `Billing frequency`, `Payment method`, `Information is accurate`, `Insurance previously declined`, and `Additional information`. Fire coverage is required. Other coverages can be toggled per location.

Schedule location sections have `data-testid="schedule-location-factory"` and `data-testid="schedule-location-warehouse"`; other locations use the same `schedule-location-<id>` form. The existing visible values also expose `schedule-version`, `schedule-headquarters-country`, and `schedule-issuing-market`. Broker sees a disabled `Approve referral` button with a senior-role explanation. The API independently rejects a broker approval with HTTP 403 and `code:'ROLE_REQUIRED'`.

Premium `total` is the premium for the full policy term, including the demo tax calculation. `annual` is the annual equivalent. Component amounts in the premium breakdown refer to the policy term; `byLocation[].annual` is annual. The interface labels these values separately.

Stable API example:

```ts
const template = createStandardDraft();
const warehouse = template.locations.find(location => location.id === 'warehouse')!;
warehouse.country = 'IT';
warehouse.address = {...ITALIAN_WAREHOUSE_ADDRESS};
warehouse.sumInsured = 1500000;
warehouse.coverages.push({type:'Flood',limit:1000000,deductible:5000});
const {policy} = await post('/api/insurance/policies', template, 'Broker');
const {quote} = await post(`/api/insurance/policies/${policy.id}/quote`, {}, 'Broker');
await post(`/api/insurance/policies/${policy.id}/documents`, {type:'Risk survey',locationId:'warehouse',name:'Approved synthetic survey',suitable:true}, 'Senior underwriter');
await post(`/api/insurance/quotes/${quote.id}/approve`, {policyId:policy.id,notes:'Reviewed survey'}, 'Senior underwriter');
await post(`/api/insurance/policies/${policy.id}/issue`, {quoteId:quote.id}, 'Broker');
```
