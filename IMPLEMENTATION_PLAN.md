# Waymark Implementation Plan

## Objective

Build a local-first audit system that measures how efficiently and reliably a
coding agent can navigate a target repository while attempting a realistic
engineering task.

The audit request originates in a paired coding-agent session such as Codex or
Claude Code. Waymark is the observer, evidence ledger, deterministic verifier,
scoring engine, and durable report surface.

## Product Boundaries

- The target repository is read-only during discovery.
- Waymark measures AI coding navigability only.
- The candidate model never assigns its own final score.
- Candidate confidence, candidate performance, and report reliability remain
  separate measurements.
- Deterministic evidence outranks model agreement.
- Mock, estimated, provider-reported, and verified values are labeled.
- The web application does not contain a prompt box or start-audit action.
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
- [ ] Run and calibrate the first real repository audit from a paired agent

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
- The UI receives live progress without polling.
- A completed report includes task, commit, models, tokens, claims, citations,
  verification coverage, scores, reliability, and recommendations.
- A candidate cannot directly set any authoritative score.
- Missing critical verification caps both the final score and reliability.
- The hostile benchmark scores below the navigable benchmark.
- A confidently wrong benchmark produces a visible confidence gap and low
  reliability.
- Stored events are sufficient to reproduce the final score.

## Milestone 2 — Real Orchestration

- Run candidate and independent research in parallel.
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

## Definition of Done for the First Build

The first build is complete only when one local audit can travel from a Codex
prompt through the skill, CLI, SQLite journal, deterministic scorer, local
service, and React report without hand-editing stored data.
