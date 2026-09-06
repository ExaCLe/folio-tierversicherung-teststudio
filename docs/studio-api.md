# Historische API des früheren Teststudios

Dieser Vertrag beschreibt den erhaltenen historischen Vorgänger. Seine alten UI-Routen und englischen Feldnamen gelten nicht für die aktive Anwendung. Der aktuelle Vertrag steht in [testing-api.md](testing-api.md); den Einstieg zeigt der [deutsche Demoguide](demo-walkthrough.md).

Die folgenden Angaben bleiben zur Einordnung früherer Daten und Testnachweise erhalten.

All paths start with `/api/studio`. Responses use the named JSON records in `shared/blocks.ts`. Errors are `{ error: string, issues?: ValidationIssue[] }` with HTTP 400, 404, 409 or 422. State persists in the shared local JSON store. Every saved scenario revision is retained.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/catalog` | | `StudioCatalog` |
| GET | `/scenarios` | | `Scenario[]` |
| POST | `/scenarios` | `{ name, description?, blocks?, tags? }` | `Scenario` |
| GET | `/scenarios/:id` | | `Scenario` |
| PUT | `/scenarios/:id` | Full `Scenario`, revision is optimistic lock | Saved `Scenario` with incremented revision |
| POST | `/scenarios/:id/duplicate` | `{ name? }` | Independent `Scenario` |
| GET | `/scenarios/:id/revisions` | | `Scenario[]` |
| GET | `/scenarios/:id/layout` | | `ScenarioLayout` |
| PUT | `/scenarios/:id/layout` | `ScenarioLayout` | Saved layout, canonical scenario untouched |
| POST | `/validate` | `{ scenario: Scenario }` | `ValidationResult` |
| POST | `/compile` | `{ scenario: Scenario }` | `CompiledScenario`, or 422 with issues |
| POST | `/interpret` | `{ scenario: Scenario, instanceId: string }` | `TextResolution` preview; ambiguous vocabulary returns 422 |
| GET | `/resolutions/:id` | | Stored `TextResolution` for inspection after reload |
| POST | `/resolutions/:id/confirm` | `{ scenario: Scenario, instanceId: string }` | Confirmed `TextResolution`; UI sets instance.resolutionId to result.id and saves scenario |
| POST | `/promote` | `PromotionRequest` | `PromotionResult`; parameterize selected ordered siblings, optionally replace selection |
| POST | `/definitions/:id/versions` | `{ definition: BlockDefinition }` | `{ definition, dependents }`; publishes next immutable version |
| GET | `/definitions/:id/dependents` | | `{ scenarioId, scenarioName, revision }[]` |
| POST | `/scenarios/:id/upgrade` | `{ definitionId, fromVersion, toVersion }` | Updated `Scenario`; only this scenario changes |
| GET | `/graph?scenarioId=...` | Optional scenario filter | `DependencyGraph` |
| GET | `/knowledge/:id` | URL encoded stable knowledge ID | `KnowledgeDocument` |
| POST | `/runs` | `{ scenarioId }` or `{ scenario: Scenario }` | 202 `RunRecord`; compiles exact persisted revision before dispatch |
| GET | `/runs?scenarioId=...` | Optional filter | `RunRecord[]` newest first |
| GET | `/runs/:id` | | `RunRecord` with mapped browser evidence |
| GET | `/runs/:id/source` | | Download exact generated Playwright source from the stored run |
| GET | `/runs/:id/artifacts/:filename` | | Screenshot, trace, driver snapshot or JSON artifact |

Seed scenario IDs are `standard-draft`, `italy-referral`, `mid-term-amendment`, and `broker-approval-denied`. The first is the gentle introduction. Italy demonstrates scoped text and a complete referral. Amendment invokes the version-pinned reusable `workflow.issue-referred@1` with different inputs. The negative scenario deliberately attempts approval as the broker.

Block references use `{ id, version }`. Values are ordinary JSON, `{ ref: 'policy' }` for a typed output, or `{ param: 'floodLimit' }` inside a reusable workflow. Actor containers have `children`. Draft creation has `changes`. Location scopes have `changes`. Definitions distinguish those two meanings. `makeBlockInstance` creates editable instances with defaults.

Compiler steps are a flat, deterministic browser execution plan. Each includes operation, actor, resolved values, explicit output symbol names, and the original instance ID. Workflow internals retain IDs as `workflow-instance/internal-instance` and list parent IDs in `ancestors`. The runner resolves logical symbols to application IDs and records those IDs as evidence.

Runner integration export is `runScenario(compiled: CompiledScenario, options?: { baseURL?: string; runId?: string; onProgress?: (run: RunRecord) => void | Promise<void> }): Promise<RunRecord>` from `server/studio/runner.ts`. The router supplies run ID and update callback for persistence. Runner owns real Playwright behavior and may add artifact middleware separately. Generated source imports the maintained driver from `e2e/helpers/insurance-driver.ts`; its final helper names are coordinated with QA.

No runtime LLM is required. Interpretation supports an explicitly documented local vocabulary and returns visible before/after fields plus preserved headquarters, issuing market and unrelated locations. A confirmation is tied to original text, scope and exact template content. Reusing a stale resolution produces a validation error.

The initial Italy scenario includes a `source: seeded-demo` confirmed interpretation and a decision ID prefixed `seeded-demo`. This makes the untouched example runnable. Newly authored text always starts as a preview and requires the explicit confirm operation.
