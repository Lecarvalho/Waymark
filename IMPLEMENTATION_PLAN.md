# Waymark Implementation Plan

## Objective

Build a local-first audit system that measures how efficiently and reliably a
coding agent can navigate a target repository while attempting a realistic
engineering task.

The audit request executes in a paired coding-agent session such as Codex or
Claude Code. Waymark may prepare a self-contained request for the user to copy
into that session; it remains the observer, evidence ledger, deterministic
verifier, scoring engine, and durable report surface.

## Product Boundaries

- The target repository is read-only during discovery.
- Waymark measures AI coding navigability only.
- The candidate model never assigns its own final score.
- Candidate confidence, candidate performance, and report reliability remain
  separate measurements.
- Deterministic evidence outranks model agreement.
- Mock, estimated, host-measured, provider-reported, unavailable, and verified
  values are labeled.
- The web application may generate a copyable audit request but never starts an
  audit, invokes a model, or writes a run from the preparation surface.
- Provider, model, and reasoning-effort choices come from read-only adapter
  capability declarations rather than hardcoded UI catalogs.
- Runs and reports are stored locally in SQLite.

## System Shape

```text
Prompt in Codex / Claude Code
            |
            v
Repository-local Waymark audit skill
            |
            v
Provider-neutral local CLI and event protocol
            |
            +--> Candidate investigation
            +--> Independent investigation
            +--> Orchestrator cross-examination
            +--> Deterministic verification
            |
            v
Versioned scoring and reliability gates
            |
            v
SQLite event journal and read models
            |
            v
Local service (REST + server-sent events)
            |
            v
React observer interface
```

## Core Contracts

### Audit input

- concise audit name
- target repository path
- immutable repository identity and commit
- simulated engineering task
- candidate model and orchestrator model identities
- tool policy and run conditions
- audit protocol and rubric versions

### Normalized event

Every observable action is appended to the run journal with:

- event id and run id
- monotonically increasing sequence
- timestamp
- actor and event type
- structured payload
- optional provider token measurement

### Evidence claim

Each claim records:

- subject and assertion
- claimant
- citations
- confidence
- criticality
- challenge history
- verification verdict
- verification method and reproducible evidence

### Score

The final report stores dimensions independently:

- discovery efficiency
- ownership clarity
- dependency clarity
- change-surface recall
- verification discoverability
- instruction quality
- token efficiency after adequacy gates
- report reliability

Scoring formulas and thresholds are versioned and independent from report prose.

## Milestone 1 — Local Vertical Slice

### Current status

- [x] Provider-neutral domain and protocol contracts
- [x] Append-only SQLite journal with schema migration
- [x] Stable JSON CLI and reserved authority boundaries
- [x] Deterministic scoring, reliability gates, canonical input hashing
- [x] Controlled navigable, hostile, and confidently-wrong fixtures
- [x] Read-only local REST and server-sent events service
- [x] React live-data connection with explicit demo fallback
- [x] Repository-local `waymark-audit` skill and orchestration templates
- [x] Automated end-to-end vertical-slice test
- [x] Run and calibrate the first real repository audit from a paired agent
- [ ] Replace inherited interactive subagents with fresh provider processes and
  mechanically enforced execution budgets (candidate, independent, and
  orchestrator roles are locally validated; repeat real-provider calibration
  still required)

### Milestone 1 completion-gate smoke-test evidence

- Real smoke-test run:
  `clapline-email-outbox-d692d68-20260724-01`
- Target: Clapline commit `d692d68afa2680309e702b12752016b8d943a793`,
  clean and read-only.
- Candidate: `gpt-5.6-terra` at low reasoning, 12,000-token target,
  180,000-token fixed hard ceiling; observed 160,438 host-measured tokens.
- Independent: `gpt-5.6-sol` at high reasoning, 24,000-token target,
  320,000-token fixed hard ceiling; observed 252,323 host-measured tokens.
- Investigation result: both assignment-only provider processes ran in parallel, streamed
  normalized events, returned schema-valid findings, stayed inside their
  command envelopes and hard ceilings, and persisted optional token dimensions
  without inventing unavailable cache-creation values.
- The resulting task-specific navigability audit completed with deterministic
  score 71.7 and reliability 65. These values measure repository navigation for
  the probe, not feature quality. Reliability was capped because the read-only
  run performed no executable probe; candidate token efficiency was ineligible
  after the adequacy gate failed.
- Known host limitation: Codex reports authoritative usage at turn completion,
  so its hard ceiling is enforced by post-completion rejection rather than
  preemptive interruption. The provider-neutral runner separately tests live
  interruption for adapters that expose cumulative usage.
- Calibration limitation: cross-examination, verification coordination, and
  recommendation drafting still ran in the controlling conversation. No
  orchestration token measurement was recorded. This smoke run validates the
  candidate/independent investigation runner but is not a valid calibration
  benchmark under the fresh-role invariant. Milestone 1 remains open until the
  orchestrator runs in its own assignment-only provider process with a fixed
  budget and the completion gate is repeated.
- Recommendation presentation gap: the run stored three recommendation events
  with observed navigation symptoms, token-efficiency mechanisms, verified
  claim IDs, and exact citations. The legacy service projection discarded that
  evidence, and the UI showed `Evidence pending` instead of a concrete
  before/after task. Before the repeat run, the authoritative workflow must
  persist structured `report.recommendations` records and the UI must render
  each cited file and line, the observed problem, a named repository change,
  its token-efficiency mechanism, limitations, and a repeatable validation
  check.
- Live-progress gap: fresh-process investigation events did not include trusted
  stage progress, so the service projected `0%` until run completion. Before
  the repeat run, progress must be deterministic, monotonic, derived from
  authoritative orchestration stages, and integration-tested from
  investigation start through terminal state.
- The second calibration attempt must validate both gaps through the live
  observer UI in addition to running the fresh, measured orchestrator. It must
  retain the first run as a separate historical record.
- Local remediation completed for the repeat attempt: the authoritative
  launcher now runs candidate and independent research in parallel, imports
  cited candidate findings, and launches a fresh assignment-only orchestrator
  with its own declared budget and host-measured token phase. Fixed workflow
  progress advances from investigation through verification and report
  generation. Recommendation drafts must pass deterministic claim verification
  before `report finalize` emits structured `report.recommendations`, and the UI
  renders cited file/line evidence, token mechanisms, concrete repository
  changes, validation checks, and limitations.
- Deterministic coverage for that remediation passes with the fake provider,
  including fresh-role isolation, all three token phases, hard-limit failure,
  live interruption, duplicate-launch rejection, verification-gated
  recommendation finalization, and progress projections at 65%, 85%, and 90%.
  The implementation is ready for the second real-provider calibration but the
  milestone remains open until that run passes the completion gate.

### Deliverables

1. Domain types for runs, events, claims, verification, token measurements, and
   score results.
2. SQLite schema and migration/bootstrap logic.
3. Provider-neutral CLI for creating a run, appending events, submitting claims,
   recording verification, finishing a run, and reading a report.
4. Local service exposing run snapshots and an SSE event stream.
5. Deterministic scoring module with explicit reliability gates.
6. Controlled benchmark fixtures for navigable, hostile, and misleading
   repositories.
7. Repository-local `waymark-audit` skill for Codex-compatible agents.
8. React UI connected to the local service, with an explicit demo-data fallback.

### Acceptance criteria

- A run can be created from the terminal without opening the UI.
- Events are durably ordered and survive process restart.
- The UI receives deterministic, monotonic live progress without polling and
  does not remain at `0%` throughout an active run.
- A completed report includes task, commit, models, tokens, claims, citations,
  verification coverage, scores, reliability, and evidence-linked
  recommendations.
- Every recommendation identifies a verified repository-specific problem,
  cites its real file or architectural evidence, proposes a named actionable
  repository-navigation change, explains the token-efficiency mechanism, and
  defines a repeatable before/after validation check.
- A candidate cannot directly set any authoritative score.
- Missing critical verification caps both the final score and reliability.
- The hostile benchmark scores below the navigable benchmark.
- A confidently wrong benchmark produces a visible confidence gap and low
  reliability.
- Stored events are sufficient to reproduce the final score.

## Milestone 2 — Real Orchestration

- Add a secondary “Prepare audit request” action that opens an accessible modal
  without displacing the active-audit viewport.
- Discover installed provider adapters and expose their available models and
  model-specific reasoning efforts through a read-only capability contract.
- Collect repository path, audit mode, concise name, task, participant
  provider/model/reasoning selections, and advanced token budgets.
- Generate a deterministic, self-contained prompt that tells the paired agent
  to use the authoritative Waymark audit workflow. Copy it only after explicit
  user action.
- Keep preparation state outside the audit journal. Opening, editing, or
  copying the request must not create a run, invoke a provider, or claim that an
  audit started.
- Run candidate and independent research in parallel.
- Launch audited roles in fresh assignment-only sessions; never charge the
  controlling development conversation to the audit.
- Declare phase token targets and hard limits, persist overruns, and reject
  over-budget runs as successful calibration benchmarks.
- Capture tool traces and token measurements where the provider exposes them.
- Cross-examine disagreements and unsupported high-confidence claims.
- Execute safe deterministic probes in the read-only target.
- Support disposable worktrees for future implementation probes.
- Record interruptions, failures, and unverifiable claims explicitly.

## Milestone 3 — Calibration

- Create answer keys for controlled repositories.
- Run repeated audits with multiple model tiers.
- Measure score ordering, variance, false confidence, and sensitivity to genuine
  repository improvements.
- Publish the rubric version and calibration results with each report.
- Define acceptable variance bands before comparing commits or models.

## Milestone 4 — Additional Agent Adapters

- Add Claude Code instructions using the same CLI and event protocol.
- Add adapter capability declarations rather than provider-specific database
  fields.
- Preserve provider-reported and estimated token counts separately.

## Milestone 5 — History and Comparison

- Compare the same task across commits.
- Compare model tiers under equivalent run conditions.
- Track whether recommendations reduce discovery work and token consumption.
- Export a self-contained report snapshot when needed.

## Repository Direction

```text
app/                         React observer interface
server/                      Local REST and SSE service
src/domain/                  Provider-neutral audit contracts
src/persistence/             SQLite schema and repositories
src/protocol/                Event validation and CLI contracts
src/scoring/                 Deterministic score and reliability logic
src/orchestration/           Run workflow and role coordination
bin/waymark.mjs              Local command-line entry point
.agents/skills/waymark-audit Agent workflow and bundled scripts
fixtures/benchmarks/         Controlled calibration repositories
tests/                       Contract, persistence, scoring, and smoke tests
```

## Implementation Order

1. Freeze types, protocol, rubric, and benchmark expectations.
2. Implement SQLite and append-only events.
3. Implement deterministic scoring and reliability gates.
4. Create and validate the audit skill.
5. Implement the local REST/SSE service.
6. Connect the React interface to the live read model.
7. Exercise one complete Codex-driven audit.
8. Calibrate before adding more providers or presentation features.

## Completion Gate for Every Milestone

Apply this gate independently to Milestones 1 through 5. A milestone is not
complete until every step passes:

1. Inventory the existing implementation paths, scripts, adapters, templates,
   tests, and documentation that overlap the milestone.
2. Identify code or instructions superseded by the new implementation. Remove
   or consolidate duplicate entry points so one authoritative workflow remains.
   Preserve helpers only when they serve a distinct, documented purpose.
3. Add deterministic tests that exercise the milestone without paid model work
   or external credentials, including its failure and limit behavior.
4. Run the repository's relevant lint, production build, tests, and diff checks.
   Resolve regressions before continuing.
5. Run a real, bounded smoke test through the authoritative user-facing path
   with fixed model identities, immutable inputs, declared token targets and
   hard limits, and live persisted evidence.
6. Confirm that the smoke test used no deprecated or parallel implementation
   path, stayed within the declared authority boundaries, and produced enough
   evidence to diagnose failures.
7. Record the validation result and any known limitation in this plan. Mark the
   milestone complete only after the real smoke test passes. Keep failed attempts
   as visible, separate records rather than rewriting or discarding them.
8. Observe the real smoke test through the UI. Confirm that progress advances
   monotonically before completion and that every recommendation renders its
   verified evidence, concrete repository change, token-efficiency rationale,
   limitations, and before/after validation check.

## Definition of Done for the First Build

The first build is complete only when one local audit can travel from a Codex
prompt through the skill, CLI, SQLite journal, deterministic scorer, local
service, and React report without hand-editing stored data.
