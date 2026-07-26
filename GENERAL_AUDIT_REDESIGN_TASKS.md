# General Audit Redesign Tasks

## How to use this file

Complete these tasks in order. Each task is written as a standalone prompt that
can be attached to a new coding session. A task may assume that its declared
dependencies have been merged, but it does not assume that the new session has
seen this planning document or the conversation that produced it.

The redesign has one central boundary:

- A `general` audit is a broad, evidence-led repository assessment performed by
  one top-tier auditor role. It is not a candidate benchmark and does not run an
  independent researcher or orchestrator.
- `task_specific` and `system_explanation` audits retain the existing measured
  candidate, independent research, orchestration, deterministic verification,
  scoring, and hard-budget behavior unless a task explicitly says otherwise.

Do not combine adjacent tasks merely because they touch the same file. The
separation is intentional: it keeps each session focused and makes failures
recoverable.

## Dependency order

```text
GA-01 --> GA-02 --> GA-03 --> GA-05 --> GA-06 --> GA-07
  |         |                         ^                   |
  +---------+--> GA-04 ---------------+                   v
                                                     GA-08 --> GA-09
                                                                |
                                                                v
                                                     GA-10 --> GA-11
                                                                |
                                                                v
                                                              GA-12

GA-12 is the integration gate and depends on every preceding task.
```

---

## GA-01 — Establish the general-audit product and protocol contract

**Dependencies:** None.

**Status:** Completed.

### Context

Waymark currently describes every audit as a reproducible navigation probe
executed through candidate research, independent research, orchestration,
deterministic verification, and scoring. The `general` mode has outgrown that
contract.

The desired general audit is a broad repository assessment conducted by one
most-capable auditor. The auditor should perform high-recall research across
production code, tests, dependency boundaries, configuration, workflows,
generated or external code, documentation, and agent instructions. It must
report both strengths and problems with rich citations. A category without
adequate evidence is `not_assessed`; absence of evidence must never be presented
as successful coverage.

General audits remain about AI coding navigability, not general code quality,
security, correctness, accessibility, or maintainability. The target repository
remains read-only.

### Goal

Update Waymark's product, design, implementation, and audit-protocol
documentation so the new general-audit contract is explicit before code begins
depending on it.

### Required changes

- Update `PRODUCT.md`, `DESIGN.md`, `IMPLEMENTATION_PLAN.md`, and the
  repository-local Waymark audit skill protocol where applicable.
- Define `general` as a single-auditor assessment. Explicitly state that it does
  not launch candidate, independent, or orchestrator roles.
- Preserve the existing pipeline for `task_specific` and
  `system_explanation`.
- Define the general auditor's required repository surfaces:
  production code, tests, dependency paths, consumers, configuration,
  workflows, generated/external boundaries, documentation, and instructions.
- Require positive evidence for a strong assessment and negative evidence for a
  weak or mixed assessment.
- Require actual source or test citations for conclusions about code structure,
  naming, ownership, dependency direction, behavior organization, and test
  mirroring. Documentation may corroborate those conclusions but cannot be
  their sole evidence.
- Require at least two representative behavior or runtime paths when the target
  repository contains them. Each path should attempt to connect entry point,
  owner, dependencies, consumers, and tests.
- Preserve the seven Practice Guide principles and the six existing weighted
  navigability dimensions:
  `discoveryEfficiency` 20%, `ownershipClarity` 17%,
  `dependencyClarity` 17%, `changeSurfaceRecall` 20%,
  `verificationDiscoverability` 16%, and `instructionQuality` 10%.
- State that dimension judgments are inferred by the general auditor from
  cited evidence. The existing benchmark observation workload and authoritative
  deterministic scorer do not score general audits.
- Define an auditor-assessed weighted result. It is available only when all
  required dimensions have adequate evidence. Partial runs expose assessed
  weight and findings without normalizing missing dimensions into a complete
  score.
- Define semantic incremental checkpoints and an append-only finding history.
- Define terminal outcomes:
  `completed`, `partial`, `failed`, and `cancelled`. `partial` means usable
  cited evidence was recovered but required coverage or synthesis is
  incomplete. `failed` means no usable report evidence was recovered.
- Remove Waymark hard token limits and token-efficiency scoring from general
  audits. Token usage remains measured and visible. Completion is driven by
  evidence coverage.
- Define soft usage notices, no-progress protection, user cancellation, and
  provider-context continuation as operational safeguards rather than
  benchmark validity rules.
- Keep the observer UI read-only. Preparing a request must not start a run or
  invoke an auditor.

### Non-goals

- Do not implement new runner, persistence, service, or UI behavior.
- Do not redesign task-specific scoring.
- Do not claim that a bounded audit can prove literal exhaustive coverage.

### Acceptance criteria

- A reader can determine which modes use the benchmark pipeline and which mode
  uses a single auditor without inspecting implementation code.
- The documentation explicitly rejects documentation-only support for
  code-structure conclusions.
- The documentation explains how partial reports, incremental findings,
  auditor-assessed dimensions, and unbounded general-audit tokens behave.
- Product, design, implementation, skill, and protocol documents do not
  contradict each other.

### Verification

- Search the changed documents for stale statements that say all general audits
  require candidate, independent, orchestrator, deterministic scoring, or hard
  token limits.
- Run relevant documentation or preparation tests if any executable contract
  fixtures were intentionally updated.

---

## GA-02 — Define the general-audit domain model and ledger projection

**Dependencies:** GA-01.

**Status:** Completed.

### Context

The product contract now defines `general` as a single-auditor, evidence-led
assessment. Findings must appear while research is active and may change as the
auditor discovers more information.

For example, an early finding that a focused verification command is missing
may later become: the command exists, but it required four searches and several
file hops to locate. The original observation remains valuable discoverability
evidence. It should be amended, not silently deleted.

The existing `EvidenceClaim` structure is immutable but represents one final
assertion. It does not model a finding's lifecycle, evidence-source balance,
navigation cost, or incremental dimension assessment.

### Goal

Add provider-neutral domain contracts and a pure append-only projector for a
general-audit finding ledger. Do not add database or UI code in this task.

### Required domain concepts

Define typed contracts for:

- A general `auditor` participant role.
- A `general_research` token phase that is separate from
  `candidate_navigation`.
- A stable finding identity and immutable finding revisions.
- Finding lifecycle states:
  `provisional`, `confirmed`, `located_late`, `reframed`, `contradicted`,
  `retracted`, and `unresolved`.
- Finding signal:
  `positive`, `friction`, or `unknown`.
- Evidence citations with repository-relative path, line range, optional
  symbol, and evidence-source classification:
  `production_code`, `test`, `configuration`, `workflow`, `documentation`,
  `instruction`, `generated`, or `external`.
- The Waymark dimension and Practice Guide IDs supported by a finding.
- Navigation-cost observations captured when relevant: searches, files opened,
  file hops, dead ends, commands, processed tokens, and elapsed time. Missing
  measurements remain `null`, never zero.
- Revision provenance: previous revision, amendment reason, actor, timestamp,
  and the evidence that caused the change.
- Representative behavior-path observations connecting any known entry point,
  owner, dependencies, consumers, and tests, with explicit unknown nodes.
- Per-dimension progress and assessment:
  auditor-inferred score, fixed weight, confidence, evidence coverage,
  supporting positive and friction finding IDs, limitations, and assessment
  state.
- Evidence coverage by dimension and evidence-source classification.
- An assessed-weight total that does not renormalize incomplete dimensions.
- A partial-report state that can be projected without final synthesis.

### Event vocabulary

Define and document normalized semantic events such as:

- `general.audit.started`
- `general.surface.inspected`
- `general.behavior_path.recorded`
- `general.finding.recorded`
- `general.finding.revised`
- `general.dimension.progress`
- `general.dimension.assessed`
- `general.recommendation.recorded`
- `general.synthesis.completed`
- `general.audit.interrupted`

Names may be adjusted to fit established conventions, but the distinction
between raw provider telemetry and semantic audit checkpoints must remain
clear.

### Projection requirements

Create a pure function that folds ordered events into the current
general-audit read model.

- Never mutate or erase an earlier finding revision.
- Reject a revision that references an unknown finding or wrong prior revision.
- Make the current finding state easy to query while preserving its timeline.
- A `located_late` or `reframed` revision must retain the earlier navigation
  cost and explain the new conclusion.
- Retracted and contradicted findings remain visible in history but cannot
  support the current assessment.
- Missing dimension assessments contribute zero assessed weight and are not
  assigned a score of zero.
- The projector must be deterministic for a given ordered event stream.

### Likely files

- `src/domain/audit.ts`
- `src/domain/index.ts`
- New focused modules under `src/domain/`; avoid generic names such as
  `utils.ts` or `helpers.ts`.
- Unit tests under `tests/`.

### Non-goals

- Do not persist the new events in SQLite yet.
- Do not launch a provider.
- Do not calculate the existing authoritative benchmark score.
- Do not add React components.

### Acceptance criteria

- A test can project a provisional missing item, revise it to `located_late`,
  and recover both the final interpretation and complete history.
- A test demonstrates that documentation-only evidence cannot satisfy a
  code-evidence coverage requirement for a code-structure dimension.
- A test demonstrates assessed-weight behavior when only some dimensions are
  complete.
- Existing task-specific domain contracts remain valid.

### Verification

- Run `npm test`.
- Run `npm run lint` if TypeScript files change.

---

## GA-03 — Persist semantic checkpoints and expose trusted CLI commands

**Dependencies:** GA-02.

**Status:** Completed.

### Context

General-audit findings and revisions now have provider-neutral domain contracts
and a deterministic projector. They must be durably appended before the UI
shows them. A provider crash after several findings must not discard those
findings.

Waymark already has an append-only SQLite event journal and a stable JSON CLI.
Generic external events cannot impersonate reserved Waymark authorities. The
new commands must preserve that authority boundary while allowing the active
general auditor to record semantic checkpoints outside the read-only target
repository.

### Goal

Add validated persistence and CLI operations for the general-audit ledger,
including a migration for any new constrained enum values or tables.

### Required changes

- Extend the SQLite schema safely for the `auditor` role,
  `general_research` token phase, and `partial` terminal status.
- Follow the existing schema-version migration pattern in
  `src/persistence/audit-store.mjs`. Do not destroy or rewrite prior audit
  history.
- Prefer the append-only event journal as the source of truth. Add dedicated
  tables only if a measured query or integrity requirement cannot be satisfied
  through events plus projection.
- Add strict validators for every semantic checkpoint payload defined in
  GA-02. Reject unknown fields, invalid transitions, invalid citations, and
  cross-run references.
- Add trusted store methods and stable JSON CLI commands for recording:
  surfaces, behavior paths, findings, finding revisions, dimension progress,
  dimension assessments, and general-audit recommendations.
- Make each append atomic and return the persisted event sequence.
- Add idempotency support so a retried provider checkpoint cannot create a
  duplicate revision.
- Prevent general-audit checkpoints from being written to a task-specific or
  system-explanation run.
- Allow reporting checkpoints only while a run is active. Final projection may
  read completed, partial, failed, or cancelled runs.
- Preserve existing reserved-actor and reserved-event protections.
- Extend `report read` so it includes the projected general-audit ledger without
  changing the existing benchmark claims, verifications, scores, or tokens.
- Add explicit completion support for `partial`; do not disguise it as
  `failed`.

### Likely files

- `src/protocol/validation.mjs` and declarations
- `src/persistence/audit-store.mjs` and declarations
- `src/domain/audit.ts`
- `bin/waymark.mjs`
- `tests/persistence.test.mjs`
- New focused protocol or projection tests

### Non-goals

- Do not build the provider checkpoint transport.
- Do not run the general auditor.
- Do not expose the ledger through the HTTP service yet.
- Do not change task-specific score authority.

### Acceptance criteria

- A run can append a finding and a later `located_late` revision through the
  CLI and reconstruct both after closing and reopening SQLite.
- Retrying the same idempotency key returns the original checkpoint rather than
  creating a duplicate.
- Invalid lifecycle transitions fail with stable machine-readable error codes.
- A partial run retains and reports every valid checkpoint.
- Existing databases migrate forward and existing benchmark reports still
  read successfully.

### Verification

- Run `npm test`.
- Exercise the new commands through `node bin/waymark.mjs` against a temporary
  database in an automated test.

---

## GA-04 — Redesign prepared requests and provider capabilities for one auditor

**Dependencies:** GA-01 and GA-02.

**Status:** Completed.

### Context

The preparation contract currently requires candidate, independent, and
orchestrator participants plus five phase token budgets for every mode. That is
correct for benchmark modes but wrong for the redesigned general audit.

The preparation modal remains preparation-only. It may discover capabilities
and generate a compact request for the user to copy, but it must not create a
run, invoke a model, or write to SQLite.

### Goal

Make the provider-neutral request and capability contracts mode-aware so a
general audit selects exactly one auditor and has no Waymark hard token budget.
Do not redesign the active report UI in this task.

### Required changes

- For `general`, expose one participant selection named `auditor` with provider,
  model, and reasoning effort.
- Continue exposing candidate, independent, and orchestrator selections for
  benchmark modes.
- Derive available auditor models from adapter capabilities. Do not hardcode a
  second model catalog in React.
- Describe general mode as broad, evidence-led repository research rather than
  a versioned benchmark task suite.
- Remove target/hard token-budget fields from the prepared general request.
  Include an explicit `tokenPolicy: unbounded_by_waymark` or equivalent
  versioned value.
- Retain token measurement and optional soft-notice configuration without
  presenting it as a stopping threshold.
- Keep existing hard budgets unchanged for task-specific and
  system-explanation requests.
- Update the copyable request so it tells the repository-local skill to create
  one general run with one auditor.
- Update the repository-local audit skill to route general requests to the new
  general command while retaining the existing benchmark workflow for the
  other modes.
- Update the preparation dialog only as much as needed to render the correct
  participant and budget fields for the selected mode. Do not implement live
  report graphics here.

### Likely files

- `src/orchestration/provider-capabilities.mjs` and declarations
- `src/orchestration/prepare-audit-request.mjs` and declarations
- `app/use-provider-capabilities.ts`
- `app/prepare-audit-dialog.tsx`
- `.agents/skills/waymark-audit/SKILL.md`
- `.agents/skills/waymark-audit/references/protocol.md`
- `tests/preparation.test.mjs`

### Non-goals

- Do not launch the auditor.
- Do not add a start-audit UI action.
- Do not remove budgets from benchmark modes.
- Do not infer monetary cost without a versioned pricing snapshot.

### Acceptance criteria

- A prepared general request contains one auditor identity and no hard token
  cap.
- A prepared task-specific request retains its existing participants and
  budgets.
- Switching modes does not leak stale participant or budget values into the
  generated request.
- Capability declarations remain the source of model and reasoning choices.
- Preparing or copying the request performs no mutation.

### Verification

- Run `npm test`.
- Run `npm run lint`.
- Run `npm run build`.

---

## GA-05 — Implement a reliable incremental checkpoint transport

**Dependencies:** GA-02 and GA-03.

**Status:** Completed.

### Context

The existing provider runner waits for one final structured output. Raw tool
telemetry is streamed, but it does not contain durable semantic findings. A
provider crash before final output can therefore leave a long investigation
with no report.

The new general auditor must record findings, revisions, behavior paths, and
dimension progress while it works. The transport must not parse arbitrary
natural-language deltas and must not grant write access to the target
repository.

### Goal

Create an adapter-neutral, trusted checkpoint channel that allows the active
general auditor to append validated semantic events to Waymark's journal during
provider execution.

### Requirements

- Use a structured transport. Acceptable designs include a dedicated reporting
  tool/MCP endpoint or another explicit structured callback supported by the
  provider adapter. Do not scrape prose for JSON fragments.
- The transport writes only to the active Waymark journal. It must not write to
  the target repository.
- Bind every checkpoint to the run ID, auditor participant, provider session,
  and idempotency key.
- Route payloads through GA-03 validation and store methods; the transport does
  not bypass domain rules.
- Acknowledge successful persistence so the auditor can avoid duplicate
  emission.
- Record rejected checkpoints as diagnostic events without treating malformed
  content as valid evidence.
- Preserve raw provider telemetry separately from semantic checkpoints.
- Keep the mechanism provider-neutral at the orchestration boundary even if
  the first implementation uses the Codex adapter.
- Ensure target read-only restrictions remain intact.

### Failure test

Extend the fake provider so it can:

1. Start one general-auditor session.
2. Emit a valid provisional finding.
3. Emit a valid revision or second finding.
4. Exit with a failure before returning final synthesis.

The integration test must prove that both acknowledged checkpoints remain in
the journal and project into a usable partial ledger.

### Likely files

- `src/orchestration/codex-adapter.mjs` and declarations
- New focused checkpoint transport module under `src/orchestration/`
- `fixtures/providers/fake-jsonl-provider.mjs`
- `src/protocol/`
- `src/persistence/`
- `tests/orchestration.test.mjs`

### Non-goals

- Do not implement the complete general research loop.
- Do not make the React UI consume the events.
- Do not use provider final output as the only checkpoint.

### Acceptance criteria

- Semantic findings are queryable before the provider process exits.
- A provider crash preserves acknowledged checkpoints.
- Duplicate delivery is idempotent.
- Malformed or unauthorized checkpoints cannot corrupt the ledger.
- Task-specific execution continues to work without using the new channel.

### Verification

- Run `npm test`.
- Run `npm run lint` when declarations or TypeScript change.

---

## GA-06 — Build the single-auditor general research runner

**Dependencies:** GA-04 and GA-05.

**Status:** Completed.

### Context

General requests now select one top-tier auditor and use an incremental
checkpoint channel. The existing `investigation run` implementation is built
around candidate and independent research followed by orchestration, hard token
enforcement, reporting reserves, and a final structured result.

General mode needs a separate execution path so benchmark behavior remains
stable.

### Goal

Add a general-audit runner and stable CLI command that launches exactly one
auditor role, drives broad repository research, persists semantic checkpoints,
and completes according to evidence coverage rather than a token cap.

### Runner behavior

- Prefer a focused module such as `general-audit-runner.mjs` instead of adding
  more mode branches throughout the benchmark process runner.
- Launch one declared auditor participant in a fresh provider process with
  assignment-only context and a read-only target.
- Do not launch candidate, independent, orchestrator, or model-based reporter
  roles.
- Provide the seven Practice Guide principles, six weighted dimensions,
  required evidence sources, and representative behavior-path requirements to
  the auditor.
- Require both positive and friction findings. Strong code-structure
  assessments require actual source/test evidence.
- Encourage the auditor to checkpoint after each defensible semantic finding
  or meaningful revision, not after every file read.
- Encourage revisiting provisional findings. If something is found later,
  amend it to `located_late` or `reframed` with the navigation cost rather than
  silently retracting the earlier observation.
- Record dimension progress incrementally and assess a dimension only when its
  evidence requirements have been attempted.
- Do not enforce Waymark target tokens, hard token limits, reporting reserves,
  or token-efficiency disqualification.
- Continue recording provider-reported or host-measured tokens under
  `general_research`.
- Support optional soft token notices. Notices are informational and cannot
  terminate or invalidate the audit.
- Add a no-progress circuit breaker based on repeated identical searches,
  repeated command failures, or sustained absence of new semantic evidence.
  A circuit breaker produces a partial report; it does not discard findings.
- When provider context is nearly exhausted, persist a continuation checkpoint
  and resume the same auditor role with the projected ledger, inspected
  surfaces, open questions, and remaining coverage. Do not introduce a second
  reviewer.
- User cancellation produces `cancelled` while preserving the ledger.
- Provider failure with usable findings produces `partial`; failure before any
  usable finding produces `failed`.

### CLI and skill routing

- Add a stable command such as `general audit` or another clear
  resource/action pair.
- Route only `auditMode: general` to this command.
- Keep `investigation run` behavior unchanged for benchmark modes.
- Update command help and repository-local skill instructions.

### Likely files

- New `src/orchestration/general-audit-runner.mjs`
- `src/orchestration/templates.mjs` or a new focused general-auditor template
- `src/orchestration/codex-adapter.mjs`
- `bin/waymark.mjs`
- `.agents/skills/waymark-audit/`
- `tests/orchestration.test.mjs`
- `tests/preparation.test.mjs`

### Non-goals

- Do not calculate a benchmark adequacy, reliability, or token-efficiency
  score.
- Do not modify the target repository.
- Do not implement report visualizations.

### Acceptance criteria

- One general command launches one auditor participant and no other model role.
- Valid findings appear in SQLite while the process is still running.
- Exceeding any prior default token value does not stop or disqualify the run.
- Context continuation retains the same ledger and remaining coverage.
- Crash, cancellation, and no-progress outcomes preserve usable evidence and
  use the correct terminal status.
- Existing task-specific orchestration tests remain unchanged and passing.

### Verification

- Run `npm test`.
- Run `npm run lint`.
- Exercise the command with the fake provider for completed, partial, failed,
  cancelled, and continuation cases.

---

## GA-07 — Assemble partial and complete reports with auditor-assessed weights

**Dependencies:** GA-02, GA-03, and GA-06.

**Status:** Completed.

### Context

The general auditor now persists a semantic finding ledger and dimension
assessments incrementally. The current authoritative scorer expects benchmark
observations such as expected locations, correct ownership answers, and
required dependency edges. Those counts are circular when the only general
researcher also defines the expected universe.

General reports therefore need a separate projection. The auditor supplies
evidence-backed dimension judgments. Waymark may perform fixed weighted
arithmetic and consistency validation, but it must not run the benchmark
observation workload.

### Goal

Create a general-report assembler that can produce a useful report at any point
in the audit and a complete auditor-assessed weighted result only when coverage
is adequate.

### Required behavior

- Preserve the existing deterministic scorer exclusively for benchmark modes.
- Project current findings, full finding timelines, behavior paths, evidence
  coverage, dimension progress, recommendations, token measurements, and
  limitations.
- Keep the six fixed weights established in GA-01.
- Treat each dimension score as an auditor assessment supported by cited
  findings, not an authoritative deterministic measurement.
- Validate dimension assessments:
  - score is within the allowed range;
  - confidence is explicit;
  - at least one current supporting finding exists;
  - strong code-related judgments include production-code or test evidence;
  - mixed and weak judgments identify concrete navigation friction;
  - `not_assessed` includes a concrete limitation.
- Calculate `assessedWeight` as the sum of completed dimension weights.
- Calculate the overall weighted result only when all required dimensions meet
  coverage requirements. Label it `auditor_assessed`.
- Never renormalize a partial subset to 100%. Do not treat missing dimensions as
  zero.
- Keep report completeness separate from the auditor's confidence and from
  repository assessment.
- Permit mechanical citation checks and safe deterministic probes to qualify
  evidence. They do not introduce another model role.
- Allow recommendations only from current supported findings. Retracted or
  contradicted revisions cannot support a recommendation.
- Preserve `located_late` and `reframed` findings as discoverability evidence.
- Make final synthesis optional. If `general.synthesis.completed` is absent,
  build the report from the ledger and clearly say synthesis is incomplete.
- Do not require at least one negative recommendation. A well-organized
  repository may receive strong, positive assessments when the code evidence
  supports them.

### Likely files

- New focused report module under `src/`
- `src/domain/`
- `src/persistence/audit-store.mjs`
- `bin/waymark.mjs`
- Keep `src/scoring/score-audit.mjs` unchanged unless a mode guard is needed
- New report-assembly tests

### Non-goals

- Do not run candidate observation-count scoring.
- Do not invent findings to fill an incomplete dimension.
- Do not create a second model synthesis step.
- Do not expose the report through HTTP yet.

### Acceptance criteria

- A complete six-dimension ledger produces the expected fixed weighted result
  labeled `auditor_assessed`.
- A four-dimension ledger reports its exact assessed weight and no overall
  result.
- A positive code-organization assessment cites actual source/test evidence.
- A documentation-only code assessment is rejected or projected as
  `not_assessed`.
- A report remains useful after the provider fails before final synthesis.
- Benchmark score fixtures produce their previous results.

### Verification

- Run `npm test`.
- Add fixtures for complete, partial, documentation-heavy, all-positive, and
  revised-late-discovery general reports.

---

## GA-08 — Expose incremental general reports through the local service and SSE

**Dependencies:** GA-03 and GA-07.

**Status:** Completed.

### Context

The local REST/SSE service is read-only and currently projects benchmark roles,
claims, authoritative scores, token budgets, and finalized practice profiles.
General findings are now durable before the provider exits, so the service must
project them immediately.

The UI already refreshes snapshots after `changed` SSE events. The service must
provide a stable mode-aware read model rather than forcing React to reconstruct
finding history or dimension coverage.

### Goal

Extend the local service and client types with a general-audit projection that
updates after every semantic checkpoint while preserving existing benchmark
snapshots.

### Required snapshot fields

- General run status: running, completed, partial, failed, or cancelled.
- Auditor identity, provider session status, and measured tokens.
- Current inspected surfaces and representative behavior paths.
- Current findings with signal, lifecycle state, latest revision, citations,
  navigation cost, and complete revision timeline.
- Per-dimension progress, fixed weight, auditor score when assessed, confidence,
  and limitations.
- Evidence coverage matrix by dimension and evidence-source classification.
- Assessed weight and overall auditor-assessed result when eligible.
- Recommendations linked to current findings.
- Synthesis availability and report completeness.
- Latest semantic checkpoint sequence so clients can reason about freshness.

### Service behavior

- Project from the append-only journal on every read; do not calculate
  authoritative general judgments in the service.
- Keep the service read-only.
- Emit or reuse an SSE `changed` notification after every committed semantic
  checkpoint.
- Ensure reconnecting clients reconstruct the same state from SQLite.
- Keep raw provider activity and semantic audit progress distinguishable.
- Use mode-aware stage labels. General mode should not display “Candidate run,”
  “Cross-examination,” or “Deterministic scoring.”
- Preserve benchmark API fields for existing consumers or version the snapshot
  deliberately with compatibility tests.
- Never present demo fallback data as live evidence.

### Likely files

- `server/waymark-server.mjs`
- `app/use-waymark-live.ts`
- `tests/service.test.mjs`
- `tests/vertical-slice.test.mjs`

### Non-goals

- Do not create new mutations in the HTTP service.
- Do not build the final React presentation.
- Do not calculate dimension judgments in the service.

### Acceptance criteria

- A finding checkpoint becomes visible through the run snapshot before the
  auditor exits.
- A later revision updates the current finding while retaining its timeline.
- A restarted service reconstructs identical general-report state.
- Partial runs expose their evidence and missing dimensions.
- Existing benchmark snapshots and SSE behavior remain compatible.

### Verification

- Run `npm test`.
- Add an SSE integration test that observes at least two incremental general
  checkpoints and a later revision.

---

## GA-09 — Build the mode-aware live general-audit interface

**Dependencies:** GA-04 and GA-08.

**Status:** Completed.

### Context

The dashboard is an observer, not a chat client or audit launcher. Its current
active-audit presentation assumes candidate research, independent research,
orchestration, deterministic verification, scoring, and finalized evidence.

General snapshots now contain one auditor, live semantic findings, dimension
progress, partial-report states, and revisions. The UI must show that work as it
arrives without presenting provisional findings as final truth.

Read `PRODUCT.md` and `DESIGN.md` before editing. Preserve the dark graphite
control-room aesthetic, native keyboard accessibility, responsive behavior,
and existing semantic colors.

### Goal

Create a mode-aware general-audit experience that displays incremental semantic
results while retaining the existing benchmark interface for other modes.

### Required interface behavior

- Replace benchmark stage labels with a general flow such as repository survey,
  behavior tracing, dimension assessment, and synthesis.
- Show exactly one auditor identity and its live token measurement.
- Add a live finding ledger ordered by semantic checkpoint sequence.
- Display finding state in text as well as color:
  provisional, confirmed, located late, reframed, contradicted, retracted, or
  unresolved.
- Let the user expand a finding to inspect citations, navigation cost, revision
  history, and amendment reason.
- Make the difference between raw activity and semantic findings obvious.
- Update dimension progress and assessed weight as checkpoints arrive.
- Do not show an overall general score until the snapshot says it is eligible.
- For partial runs, preserve every finding and identify missing dimensions and
  incomplete synthesis.
- Use lime for verified/current evidence, amber for pending or disputed state,
  red for contradicted or failed state, and blue for measured auditor activity.
- Keep the existing Progress, Evidence, and Recommendations progressive
  disclosure or replace it only with an equally clear hierarchy.
- Adapt the preparation modal to the GA-04 one-auditor contract if that task
  made only minimal rendering changes.
- Keep “Prepare audit request” secondary and preparation-only.
- Preserve loading, empty, running, complete, partial, failed, cancelled,
  offline, and demo states.

### Likely files

- `app/page.tsx`
- `app/use-waymark-live.ts`
- `app/prepare-audit-dialog.tsx`
- `app/globals.css`
- `tests/rendered-html.test.mjs`

### Non-goals

- Do not add chart-heavy graphics yet; GA-10 and GA-11 own them.
- Do not invoke the auditor from React.
- Do not add mutations to the local HTTP service.
- Do not remove the static Practice guide.

### Acceptance criteria

- Two semantic checkpoints and one revision visibly update the active report
  without a page reload.
- Provisional evidence cannot be mistaken for a completed assessment.
- A `located_late` timeline clearly communicates “exists but was hard to
  discover.”
- Partial and failed runs are visually and semantically different.
- Task-specific and system-explanation reports retain their existing execution
  presentation.
- Keyboard and responsive behavior remain usable.

### Verification

- Run `npm run build`.
- Run `npm test`.
- Run `npm run lint`.
- Inspect the active general audit at desktop and narrow viewport widths.

---

## GA-10 — Add weighted dimension and evidence-coverage graphics

**Dependencies:** GA-08 and GA-09.

**Status:** Completed.

### Context

The most important general-report graphics are not decorative charts. They must
answer two questions:

1. How did the auditor assess each weighted navigability dimension?
2. Did each assessment actually inspect code, tests, configuration, workflows,
   documentation, and instructions?

The second question prevents a documentation-heavy report from masquerading as
code coverage.

### Goal

Add two accessible, responsive, incrementally updating graphics: weighted
dimension bars and an evidence-coverage matrix.

### Weighted dimension graphic

- Use horizontal labeled bars rather than a radar chart.
- Show dimension name, fixed weight, assessment status, auditor score when
  available, confidence, and evidence coverage.
- Distinguish assessed, in progress, and not assessed without relying on color
  alone.
- Represent partial coverage honestly. Do not draw missing dimensions as zero.
- Show assessed weight separately from any complete overall result.
- If an overall result is available, label it `Auditor-assessed`.
- Allow keyboard users to reach the dimension detail that lists supporting
  findings and limitations.

### Evidence-coverage matrix

- Rows are the six dimensions.
- Columns include production code, tests, configuration, workflows,
  documentation, instructions, generated code, and external code.
- Each cell communicates current cited evidence count or coverage status and is
  accessible without color.
- Activating a cell filters or reveals the linked findings and citations.
- Make documentation-only support for code-related dimensions immediately
  visible.
- Clearly distinguish “not inspected,” “inspected with no finding,” and
  “supported by cited evidence.”

### Design constraints

- Follow `DESIGN.md`: flat panels, restrained borders, no glow, no gradients,
  no decorative circular meters.
- Prefer CSS and semantic HTML. Do not add a charting dependency unless the
  implementation cannot meet accessibility and responsiveness without one.
- Signal colors retain their established meanings.
- Graphics must update without animation that creates urgency or obscures
  changing evidence.

### Likely files

- New small typed components under `app/`
- `app/page.tsx`
- `app/globals.css`
- `app/use-waymark-live.ts`
- `tests/rendered-html.test.mjs`

### Non-goals

- Do not add behavior graphs, discovery timelines, or historical comparisons.
- Do not infer missing evidence in React.
- Do not use radar or donut charts as the primary summary.

### Acceptance criteria

- A documentation-heavy fixture is visually distinguishable from a
  code-and-test-supported fixture.
- Partial dimensions do not look like low-scoring completed dimensions.
- Every visual value has an accessible text equivalent.
- The graphics work at desktop and narrow widths.
- Live checkpoint updates preserve focus and do not reorder expanded content
  unexpectedly.

### Verification

- Run `npm run build`.
- Run `npm test`.
- Run `npm run lint`.
- Perform visual inspection for complete, partial, documentation-heavy, and
  all-positive fixtures.

---

## GA-11 — Add investigation-path, finding-evolution, recommendation, and trend graphics

**Dependencies:** GA-08, GA-09, and GA-10.

**Status:** Completed.

### Context

Dimension bars and the evidence matrix summarize the report, but they do not
show why something was difficult to navigate. General audits also preserve
representative behavior paths, search cost, finding revisions,
recommendations, and comparable historical runs.

These graphics must remain evidence views, not decorative repository diagrams.

### Goal

Add progressive-disclosure graphics for navigation paths, finding evolution,
recommendation prioritization, and historical dimension changes.

### Required graphics

#### Behavior navigation map

- Show sampled entry point, owner, dependencies, consumers, and tests.
- Preserve unknown or uninspected nodes instead of fabricating connections.
- Link nodes and edges to citations.
- Encode verified/current, difficult-to-discover, pending, and contradicted
  states with text or patterns in addition to color.
- Keep each map focused on one representative behavior; do not render the
  entire repository as an unreadable graph.

#### Discovery journey

- Show searches, files opened, dead ends, and the point at which the target was
  located.
- Support the `located_late` narrative directly.
- Use measured values only. Unavailable values remain unavailable.

#### Finding evolution timeline

- Show the initial finding and every amendment in sequence.
- Include the evidence and reason that caused confirmed, located-late,
  reframed, contradicted, or retracted transitions.
- Make the current interpretation obvious without erasing history.

#### Recommendation impact/effort view

- Plot or tabulate evidence-backed navigation impact against implementation
  effort.
- Keep recommendations linked to their current findings and affected
  dimensions.
- Do not imply exact projected score gains unless a separately validated model
  exists.

#### Historical dimension trends

- Compare only compatible general audits with the same rubric/version and
  dimension definitions.
- Show per-dimension changes and evidence coverage alongside the score.
- Mark partial runs rather than placing them on a misleading complete-score
  line.
- Expose repository commit and audit date for every point.

### Design constraints

- Use progressive disclosure. Do not render every graphic at once.
- Prefer small multiples, timelines, tables, and focused path maps.
- Preserve keyboard accessibility and readable text equivalents.
- Follow the existing semantic color system and responsive design.

### Likely files

- New focused typed components under `app/`
- `app/page.tsx`
- `app/globals.css`
- `server/waymark-server.mjs` only if compatible-run history needs an additional
  read-only projection
- `tests/service.test.mjs`
- `tests/rendered-html.test.mjs`

### Non-goals

- Do not add a generic repository visualization engine.
- Do not infer edges or historical comparability in React.
- Do not turn the observer into an interactive repository editor.

### Acceptance criteria

- A located-late fixture shows the complete discovery journey and finding
  amendment.
- A behavior map exposes both known and unknown path elements with citations.
- Recommendation prioritization does not claim unsupported score gains.
- Historical trends exclude or explicitly mark incompatible and partial runs.
- Every graphic has an accessible textual representation.

### Verification

- Run `npm run build`.
- Run `npm test`.
- Run `npm run lint`.
- Visually inspect each graphic with complete, partial, revised, and
  incompatible-history fixtures.

---

## GA-12 — Harden recovery, compatibility, and the end-to-end general audit

**Dependencies:** GA-01 through GA-11.

**Status:** Completed.

### Context

The complete redesigned path now includes mode-aware preparation, one general
auditor, incremental semantic checkpoints, an append-only finding ledger,
coverage-driven completion, partial reports, mode-aware service projections,
and incremental graphics.

This task is deliberately last. It validates the integrated behavior and fixes
cross-boundary gaps without expanding product scope.

### Goal

Prove that a general audit remains useful across crashes, restarts,
continuations, malformed checkpoints, cancellation, and incomplete coverage,
while benchmark modes remain reproducible and unchanged.

### Required scenarios

Add end-to-end fixtures and tests for:

1. A complete all-positive audit with real code and test citations.
2. A complete mixed audit with code, workflow, and instruction findings.
3. A documentation-heavy audit whose code dimensions remain `not_assessed`.
4. A finding revised from provisional absence to `located_late`.
5. A provider crash after multiple persisted findings but before synthesis.
6. A provider context continuation that preserves auditor identity and ledger
   state.
7. User cancellation after useful evidence.
8. A no-progress circuit breaker after repeated searches.
9. A malformed or duplicate checkpoint.
10. Service restart and UI reconnection during an active audit.
11. A prior database migrated forward without losing benchmark history.
12. Existing task-specific and system-explanation benchmark runs producing
    their previous score and reliability behavior.

### Recovery requirements

- Semantic checkpoint acknowledgement means the evidence survives process,
  service, and UI restarts.
- Final synthesis failure cannot erase or hide current findings.
- `partial` is used whenever usable cited evidence exists but completion
  requirements were not met.
- `failed` is reserved for runs with no usable report evidence.
- Continuation uses the projected ledger and open coverage, not raw inherited
  controlling-session context.
- Replayed checkpoints are idempotent.
- The target repository remains read-only through every scenario.

### Documentation and cleanup

- Update CLI help, README usage, skill instructions, protocol references,
  product documentation, and design documentation to match shipped behavior.
- Remove obsolete general-mode branches that still invoke candidate,
  independent, orchestrator, deterministic general scoring, or hard token
  enforcement.
- Do not remove the corresponding benchmark code.
- Confirm mock and live data remain visibly distinct.

### Non-goals

- Do not redesign benchmark scoring.
- Do not add cloud mutation or deployment behavior.
- Do not introduce an additional model role as a recovery shortcut.

### Acceptance criteria

- Every required scenario has an automated assertion at the lowest practical
  layer and at least one end-to-end vertical-slice test.
- A failed provider with acknowledged findings produces a readable partial
  report in the UI.
- A complete general audit shows its evidence-backed dimensions and graphics
  without benchmark-only labels.
- Existing benchmark fixtures and score reproducibility remain unchanged.
- Documentation and runtime behavior agree.

### Verification

- Run `npm run build`.
- Run `npm test`.
- Run `npm run lint`.
- Run `npm run waymark -- help` and confirm the mode-specific commands and copy
  are accurate.
- Perform one manual read-only audit against a disposable fixture repository,
  including an intentional interruption after persisted findings.
