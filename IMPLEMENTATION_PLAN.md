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

### Milestone 1 completion-gate calibration attempt 2

- Failed calibration run:
  `clapline-email-outbox-d692d68-20260724-02`.
- The run used a new SQLite journal with no prior runs. The Clapline target was
  clean and read-only at immutable commit
  `d692d68afa2680309e702b12752016b8d943a793` before launch and remained clean at
  that commit after all role processes completed.
- Preflight validation passed before paid work: the installed Codex JavaScript
  entry point was invoked directly on Windows, the read-only local service
  exposed the intended SQLite path and SSE `ready` event, lint and production
  build passed, all 28 deterministic tests passed, and `git diff --check` was
  clean.
- The authoritative `investigation run` launcher executed fresh,
  assignment-only candidate and independent processes in parallel, imported
  seven candidate claims, and then executed a fresh assignment-only
  orchestrator. No controlling-conversation or inherited subagent context was
  charged to the run.
- Host-measured role usage stayed below the predeclared token hard ceilings:
  candidate `gpt-5.6-terra` low used 166,271 processed tokens against a
  12,000-token target and 180,000-token ceiling; independent `gpt-5.6-sol` high
  used 205,874 against a 24,000-token target and 320,000-token ceiling; and
  orchestrator `gpt-5.6-sol` high used 194,423 against a 12,000-token target and
  320,000-token ceiling. Total measured role-process usage was 566,568 tokens.
  Optional cache-creation tokens remained unavailable rather than being
  recorded as zero.
- The run is calibration-ineligible because the candidate emitted seven
  persisted `command_execution` starts against its declared six-command
  envelope. The independent used 8/8 and the orchestrator used 6/6. The current
  launcher communicates shell-command limits in the assignment but does not
  mechanically stop or reject a role when that limit is crossed.
- Deterministic static inspection recorded verdicts for every claim: five were
  verified and two remained explicitly unverified. The unverified transaction
  claim combined observed Npgsql behavior with an architectural preference and
  assumptions about uninspected writers. The unverified change-surface claim
  cited message, sender, and template abstractions while asserting a broader
  schema, dispatcher, retry, monitoring, and integration-test topology that its
  citations did not establish.
- `report finalize` correctly rejected the recommendation draft with
  `RECOMMENDATION_CLAIM_NOT_VERIFIED`; therefore no structured recommendations
  were finalized and authoritative scoring was not run. The attempt was
  finished as `failed` with the command-budget violation and finalizer rejection
  persisted in the append-only journal. No score or reliability value exists
  for this attempt.
- Live observer checks saw monotonic authoritative progress at 5% during
  parallel research, 40% during fresh orchestration, 65% during deterministic
  verification, and a terminal failed projection at 79%. The failed report
  showed all three model roles complete with measured usage, five verified of
  seven claims, zero finalized recommendations, no authoritative score, and the
  completion-gate failure message. These checks used the dedicated observer on
  web port 5182 and service port 4319; the separately running default observer
  was connected to port 4318 and an empty default journal.
- Milestone 1 remains open. Before another paid calibration, mechanically
  enforce or post-completion reject shell-command envelopes, and constrain
  candidate claims/recommendation evidence so proposed navigation changes cite
  atomic, deterministically verifiable repository facts. Preserve this failed
  run as a separate historical record.

Remediation completed after the second attempt:

- The authoritative runner now counts live `command_execution` starts and
  interrupts on shell command N+1. It persists `policy.violation`, counts a
  provider-declined command, rejects any post-completion overrun, and marks the
  run calibration-ineligible.
- Candidate output now requires `kind: "repository_fact"`, one atomic
  current-repository assertion, and at least one valid line-range citation.
  Assignment constraints prohibit implementation advice, desired future
  architecture, and proposed change-surface assertions; the output schema and
  runtime importer reject the wrong finding kind or invalid citations.
- Orchestrator assignments may cite only supplied factual claims in
  recommendations and must omit a recommendation when no supported fact exists.
  This keeps navigation recommendations separate from the probe feature's
  implementation.
- The observer now separates verified claims from adjudicated claims, counts
  terminal `unverified` verdicts in progress, reports a completed verifier when
  every claim has a verdict, and labels missing score/reliability values as
  unavailable after failure.
- Audit preflight now requires the user-visible web URL and its service to read
  the exact selected journal. An existing observer must be reused or restarted;
  a second silent web/service port is not acceptable. The repaired read model
  was checked at `http://localhost:3000` against service port 4318 and the
  preserved failed journal: it showed 85% terminal progress, 5/7 verified,
  7/7 adjudicated, unavailable score/reliability, a completed verifier, and no
  browser console errors.
- Deterministic regression coverage includes command N+1 with a declined
  seventh command, invalid non-factual candidate output, and terminal
  unverified adjudication. `npm run lint`, `npm run build`, and all 31 tests
  pass. Milestone 1 remains open until a new real calibration passes with the
  already declared token ceilings unchanged.

### Milestone 1 completion-gate calibration attempt 3

- Failed calibration run:
  `clapline-email-outbox-d692d68-20260724-03`.
- The run used the clean SQLite journal
  `.waymark/clapline-20260724-attempt3.sqlite`. The observer at
  `http://localhost:3000` reported that exact journal through service port
  4318, exposed one intended run before launch, and emitted the SSE `ready`
  event.
- The Clapline target was clean and read-only at immutable commit
  `d692d68afa2680309e702b12752016b8d943a793` before launch and remained clean
  at that commit after the role processes stopped.
- Preflight validation passed before paid work: the installed Codex 0.144.1
  JavaScript entry point supported ephemeral JSONL execution, assignment stdin,
  output schemas, and the read-only sandbox; lint, the production build, all 31
  deterministic tests, and `git diff --check` passed.
- The authoritative `investigation run` launcher started fresh,
  assignment-only candidate and independent processes in parallel. The
  candidate attempted command 7 against its fixed six-command envelope.
  Waymark interrupted the process from the live JSONL stream, appended
  `policy.violation` with `live_stream_interrupt`, and marked the attempt
  calibration-ineligible. Declined and failed provider commands counted because
  each had already consumed a command start.
- The independent process completed its 8/8-command investigation and used
  206,745 host-measured processed tokens against its 24,000-token target and
  320,000-token hard ceiling: 198,302 input, 168,620 cached-input (a subset of
  input), and 8,443 output tokens. Cache-creation tokens remained unavailable.
  The interrupted candidate emitted no completion usage event, so candidate
  usage remained unavailable rather than being recorded as zero.
- The failed parallel-investigation gate imported no candidate claims and did
  not launch the fresh orchestrator. Deterministic verification, report
  finalization, and authoritative scoring therefore did not run. The attempt
  has no score, reliability value, finalized recommendation, or candidate token
  efficiency result.
- The live observer showed the intended run at 0% before launch, then 5% with
  candidate and independent roles active. Its terminal report showed the
  candidate failed, the independent complete with 206.7k host-measured tokens,
  the orchestrator and verifier not run, and score and reliability unavailable.
  No browser console errors were present.
- Terminal progress remained monotonic but stopped at 5% because the failure
  occurred during the first audited phase. The UI rendered the detailed stored
  command-budget failure as `Audit failed: unknown failure.` This diagnostic
  projection must surface the `shell_command_budget_exceeded` reason and its
  observed and declared counts before the next completion-gate attempt.
- The six-command candidate envelope is below both the seven commands observed
  in the completed candidate process from attempt 2 and the interrupted
  command 7 in this attempt. A future run must declare a separately justified
  command ceiling before launch; it must not rewrite this failed attempt or
  relax a limit after observing a live run.
- Milestone 1 remains open. Attempt 3 proves the repaired mechanical
  command-budget enforcement against a real provider, but it did not reach
  fresh orchestration, deterministic verification, finalized recommendations,
  scoring, or the completed-report UI gate.

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
