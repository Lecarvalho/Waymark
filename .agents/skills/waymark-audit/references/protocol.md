# Waymark audit protocol

Use file inputs for non-trivial payloads. Every CLI response is one JSON object:
`{"ok":true,"command":"…","data":…}` or `{"ok":false,"error":…}`. Stop on a
nonzero exit status or `ok:false`.

## Create the run

Route on `auditMode` before constructing participants, execution policy, or
tokens. The contracts are intentionally different:

- `general` creates exactly one `auditor` participant for broad repository
  research. It does not launch candidate, independent, verifier, or
  orchestrator roles and does not use a benchmark task suite.
- `task_specific` and `system_explanation` retain the candidate, independent,
  orchestrator, deterministic-verification, scoring, and hard-budget pipeline.

### General run contract

A redesigned general run has this provider-neutral shape:

```json
{
  "targetRepositoryPath": "C:/repos/example",
  "repositoryIdentity": "example",
  "commitSha": "starting-sha-for-provenance",
  "name": "General repository navigation",
  "task": "Broad evidence-led repository navigability assessment",
  "participants": [
    {"role":"auditor","provider":"openai","model":"most-capable-model"}
  ],
  "toolPolicy": {
    "target":"read-only",
    "network":"declared",
    "sandboxMode":"read-only",
    "approvalPolicy":"never"
  },
  "runConditions": {
    "auditMode": "general",
    "verificationPolicy": "repository_appropriate",
    "auditorReasoningEffort": "high",
    "auditorPermissionMode": "read_only",
    "execution": {
      "isolation": "fresh_process",
      "contextPolicy": "assignment_only",
      "measurementScope": "role_process_only"
    },
    "tokenPolicy": "unbounded_by_waymark",
    "softUsageNoticeTokens": null,
    "pricingSnapshot": null
  },
  "protocolVersion": "general-audit-contract/1.1.0",
  "rubricVersion": "waymark-navigability/1.0.0"
}
```

`general` has no `taskSuite`, phase `tokenBudgets`, or benchmark participant
selection. Usage is recorded in the separate `general_research` phase.
`softUsageNoticeTokens`, when present, informs the operator but never stops the
auditor or determines report validity.

`commitSha` records where the run began; it does not freeze the target. A
general auditor reports the files and repository state it actually observes and
does not fail solely because HEAD or the worktree changes during the run.

General auditor permission modes are explicit runtime inputs:

- `read_only` is the default and launches Codex with approval policy `never`
  and sandbox mode `read-only`.
- `unrestricted_no_approval` is an explicit user authorization. Persist
  `toolPolicy.target=full-access`, `toolPolicy.network=enabled`,
  `toolPolicy.sandboxMode=danger-full-access`, and
  `toolPolicy.approvalPolicy=never`. The Codex adapter then launches the auditor
  without approval prompts or sandbox restrictions. The assignment must still
  state that full access is for command compatibility only and prohibit
  modifying, creating, deleting, installing, formatting, or generating
  anything in the target repository.

Never launch full access while the journal claims the target was read-only.

Create the run with the provider-neutral command, then launch the single
auditor runner:

```powershell
node bin/waymark.mjs --db <journal> run create --input-file <general-run.json>
node bin/waymark.mjs --db <journal> general audit --run <run-id>
```

The runner starts the semantic ledger, launches exactly the persisted auditor,
and gives that process the authenticated checkpoint channel. Do not start the
ledger manually before invoking the runner. Do not pass a general request to
`investigation run`, `score calculate`, or another benchmark-only command.

### Benchmark run contract

```powershell
node bin/waymark.mjs --db <journal> run create --input-file <run.json>
```

`run.json`:

```json
{
  "targetRepositoryPath": "C:/repos/example",
  "repositoryIdentity": "example",
  "commitSha": "starting-sha-for-provenance",
  "name": "Partial refund change surface",
  "task": "Trace the change surface for partial refunds",
  "participants": [
    {"role":"orchestrator","provider":"openai","model":"model-id"},
    {"role":"candidate","provider":"openai","model":"model-id"},
    {"role":"independent","provider":"openai","model":"model-id"},
    {"role":"verifier","provider":"local","model":"deterministic"}
  ],
  "toolPolicy": {"target":"read-only","network":"declared"},
  "runConditions": {
    "auditMode": "task_specific",
    "parallelResearch": true,
    "verificationPolicy": "repository_appropriate",
    "candidateReasoningEffort": "low",
    "independentReasoningEffort": "high",
    "orchestratorReasoningEffort": "high",
    "execution": {
      "isolation": "fresh_process",
      "sessionPersistence": "local_telemetry_log",
      "contextPolicy": "assignment_only",
      "measurementScope": "role_process_only",
      "shellCommandBudget": {
        "candidate": 6,
        "independent": 8,
        "orchestrator": 6
      }
    },
    "tokenBudgets": {
      "candidate_navigation": {"targetTokens":12000,"hardLimitTokens":24000},
      "independent_validation": {"targetTokens":24000,"hardLimitTokens":48000},
      "orchestration": {"targetTokens":12000,"hardLimitTokens":24000},
      "deterministic_verification": {"targetTokens":6000,"hardLimitTokens":12000},
      "report_generation": {"targetTokens":4000,"hardLimitTokens":8000}
    },
    "pricingSnapshot": null
  },
  "protocolVersion": "1.0.0",
  "rubricVersion": "waymark-navigability/1.0.0"
}
```

`name` is a concise audit-history label of at most 72 characters. Keep `task`
verbatim as the reproducible navigation probe and record `auditMode` as
`task_specific` or `system_explanation`. Participant roles must be unique.
Candidate and orchestrator are required. Prepared requests may omit names and
fixed policy values that the skill defines; resolve them before constructing
`run.json`. Never infer or replace explicit participant selections, reasoning
efforts, token budgets, service URL, expected journal, mode, or probe text.

## General auditor protocol

The general auditor runs in one fresh, assignment-only provider process using
the permission mode persisted with the run. The controlling conversation is not
audit context. A
provider-context continuation launches a fresh process for the same persisted
auditor role when necessary. It receives the projected finding ledger,
inspected surfaces, open questions, and remaining coverage rather than raw
provider history or unrecorded controlling-session context.

Research must cover these repository surfaces:

- production code
- tests
- dependency paths and consumers
- configuration
- workflows
- generated and external boundaries
- documentation
- agent and repository instructions

The auditor reports favorable organization and navigation friction. Strong
judgments require positive cited evidence; mixed or weak judgments require
concrete cited friction. Inadequate evidence produces `not_assessed`, never a
favorable default.

Conclusions about code structure, naming, ownership, dependency direction,
behavior organization, or test mirroring require citations to actual source or
tests. Documentation may corroborate those conclusions but cannot be their sole
support. When the repository contains representative behavior or runtime paths,
the auditor attempts at least two paths. Each observation records the known
entry point, owner, dependencies, consumers, and tests and preserves unknown or
uninspected nodes.

### Practice Guide and dimensions

The seven Practice Guide principles remain:

1. organize around behavior
2. make dependency direction explicit
3. name files for the concept they own
4. provide one canonical workflow
5. put instructions close to the code
6. make tests mirror behavior
7. separate generated and external code

The six dimensions and fixed weights remain:

- `discoveryEfficiency`: 20%
- `ownershipClarity`: 17%
- `dependencyClarity`: 17%
- `changeSurfaceRecall`: 20%
- `verificationDiscoverability`: 16%
- `instructionQuality`: 10%

Dimension judgments are auditor inferences supported by cited findings. The
benchmark observation-count workload and authoritative deterministic scorer do
not score general mode.

An overall weighted result is available only when all required dimensions have
adequate evidence and is labeled `auditor_assessed`. A partial report exposes
the sum of assessed dimension weights and available findings. It never
renormalizes that subset to 100%, assigns zero to a missing dimension, or
presents incomplete coverage as a complete score.

### Incremental evidence

Append semantic checkpoints while the auditor works. Keep semantic findings
separate from raw provider telemetry. At minimum, checkpoints cover inspected
surfaces, representative behavior paths, findings, finding revisions, dimension
progress and assessment, recommendations, and synthesis.

Every finding has a stable identity and immutable revisions. Later evidence may
confirm, locate late, reframe, contradict, retract, or leave a finding
unresolved, but it never erases an earlier revision. A late discovery retains
the earlier navigation-cost observation and explains the changed conclusion.

### Completion and safeguards

General terminal outcomes are:

- `completed`: required coverage and synthesis are complete.
- `partial`: usable cited evidence exists, but required coverage or synthesis
  is incomplete.
- `failed`: no usable report evidence was recovered.
- `cancelled`: the user stopped the audit; durable cited evidence remains
  available.

General mode has no Waymark hard token limit and no token-efficiency score.
Record available usage in `general_research`. Completion is driven by evidence
coverage.

Soft usage notices, user cancellation, and provider-context continuation are
operational safeguards, not benchmark validity rules. A soft notice does not
stop work. User cancellation and provider failure retain acknowledged evidence. If
coverage or synthesis remains incomplete but usable cited evidence exists,
finish `partial`, not `failed`.

The runner records a semantic `general.continuation.recorded` checkpoint before
each context continuation. Replayed checkpoints are idempotent. Repeated
identical searches, repeated command failures, or sustained tool activity
without new semantic evidence trigger the no-progress circuit breaker. With
usable cited evidence the outcome is `partial`; without usable report evidence
the ledger invariant requires `failed`. Neither outcome discards acknowledged
findings.

## Benchmark isolated role execution

Audited roles must not inherit the controlling conversation. For Codex, launch
each role as a new non-resumed process with `codex exec --json`, the target as
its working directory, and a read-only sandbox. Pass only the rendered
assignment prompt and required repository instructions. Do not include operator
conversation, Waymark source changes, previous agent traces, or UI debugging
context.

Parse the JSONL stream as it arrives. `turn.completed.usage` supplies input,
cached-input, and output tokens. Cached input is a subset of input, so processed
tokens are `input + output`, not `input + cached input + output`. Match the
emitted provider session ID to its local Codex rollout file and persist only
normalized cumulative/current-context snapshots; never copy rollout contents
into the audit journal. Persist live tool events during the turn and the final
host-measured usage at completion.

For the built-in Codex adapter, run the isolated candidate, independent, and
orchestrator processes for an existing active run with:

```powershell
node bin/waymark.mjs --db <journal> investigation run --run <run-id>
```

In Codex desktop managed sandboxes, run this provider-spawning command with
`sandbox_permissions: require_escalated` on the first attempt. Its child Codex
processes require outbound access to the provider API even though their target
repository sandbox and shell-command network policy remain read-only and
disabled. Request a reusable approval prefix scoped to
`node bin/waymark.mjs ... investigation run`; do not first launch it in the
restricted outer sandbox and consume a single-run authorization with a
terminal connectivity failure. Local service, journal, verification,
finalization, and scoring commands remain un-escalated unless they
independently require broader access. A no-model launcher preflight does not
prove provider API connectivity.

Use `--codex-entry <path-to-codex.js>` or `WAYMARK_CODEX_ENTRY` when automatic
launcher discovery is unavailable. Candidate and independent research runs in
parallel. The runner imports candidate findings, then launches the orchestrator
with only the task, recorded target provenance, run policy, cited claims, and bounded
investigation results. A successful command keeps the run active for
deterministic verification. A candidate failure, interruption, or missing
structured candidate result finishes the run as failed or cancelled. When the
candidate completes but independent research fails, the runner imports the
candidate evidence, records `investigation.degraded`, continues orchestration
with independent coverage explicitly unavailable, and makes the run
calibration-ineligible. It must not imply independent agreement. A
completion-only hard-limit overrun retains the structured result, continues the
benchmark, and records a failed resource-envelope outcome.

Import is loss-tolerant at semantic evidence boundaries. Preserve every valid
cited candidate navigation finding when another finding or practice reference
is malformed. Remove only invalid, duplicate, mismatched, rejected, or
out-of-range references. Append `investigation.degraded` with structural issue
details, make the run calibration-ineligible, and continue. Do not infer an
intended index, auto-link an unselected finding, or treat rejected evidence as
verified. The candidate phase is fatal only when it leaves no usable cited
navigation finding.

Every benchmark run declares the budget object shown above. Interrupt providers that
expose live cumulative usage when the reporting reserve is reached. The reserve
must include the current context that a resumed turn will replay plus bounded
report output; the final 20% is a minimum, not a complete cost estimate. Stop
the full provider process tree and resume the same session once with a no-tools
structured-report directive. If telemetry jumps directly past the hard limit,
or the provider exits over budget without output, make that same reporting-only
rescue attempt. It has a five-minute safety deadline, remains subject to the
declared hard token limit, and any tool call invalidates it.
Providers that only report usage at turn completion must append
`budget.exceeded`, retain a complete result, and continue the audit when the
final value crosses the limit. The report remains valid evidence and must
distinguish task completion from the failed resource-envelope outcome.
Shell command budgets are enforced from live command-start events. Command N+1
stops exploration, appends `policy.violation`, and disqualifies the run. When
the provider can resume the same session, Waymark makes one five-minute no-tools
reporting attempt and retains that structured result as partial,
calibration-ineligible evidence. A provider-declined command still counts
because the attempted command has already consumed navigation budget.
The target is the efficiency objective; the hard limit is a separately
calibrated validity ceiling. Establish the ceiling before the run from a prior
bounded measurement for the same host/model/task class. Do not raise it after
seeing the current result. Preserve any over-budget attempt as a distinct
report. Score its verified navigability evidence and label the resource
envelope as exceeded rather than claiming that it stayed within the declared
reference.

Use a preflight to confirm the exact provider launcher and read-command policy.
Reuse the observer and service already started by the user. Call `/health`,
treat its `databasePath` as the authoritative journal, and pass that exact path
with `--db` to every CLI command. Create each audit as a new run in that shared
journal; never create a new database per audit. Confirm the intended run ID in
the UI before launching paid roles. If the service is unavailable or its
journal differs from the prepared request, stop and report the mismatch. Do not
run the development launcher, switch ports, or restart user-owned processes.
On Windows/Node 24, spawning a `.cmd` file directly can fail with `EINVAL`;
launch the provider's JavaScript entry point with `process.execPath`, or use a
known-compatible shell invocation. Narrow file-name discovery and selected-file
searches are more reliable than pipelines or repository-wide matching-line
searches under strict execution policies.

## Benchmark journal evidence

```powershell
node bin/waymark.mjs --db <journal> event append --input-file <event.json>
node bin/waymark.mjs --db <journal> claim submit --input-file <claim.json>
node bin/waymark.mjs --db <journal> verification record --input-file <verification.json>
node bin/waymark.mjs --db <journal> token record --input-file <token.json>
```

Recommended event types are `investigation.started`, `search.performed`,
`file.opened`, `dead_end.encountered`, `rule.found`, `answer.recorded`,
`challenge.raised`, `challenge.resolved`, `probe.result`, `probe.executed`,
`investigation.completed`, and `investigation.failed`. Event actors and types
beginning with `waymark`, plus `score.*` and `run.finished`, are reserved.

Candidate claims are cited facts about repository navigability only. Each must
name one scored Waymark dimension and the concrete navigation friction it
caused. The selected task or explanation question is a probe used to test
whether the agent found and understood the relevant surface. Persist that
understanding as a
validator-only `probe.result`; never link it to recommendations or present
system mechanics as the report's primary evidence. For a
`system_explanation` run, record that mode in `runConditions`, use a concise
supported answer as the adequacy gate, and primarily measure the tokens and
navigation work required to find it. Do not reward prose depth or require
hypothetical change-surface recall.

Choose verification commands from the target repository's documented workflow;
do not assume a language, package manager, test framework, or service topology.
Use this order:

1. Static inspection when source, configuration, or a dependency graph fully
   proves a navigation-only claim.
2. A sandboxed executable probe when it is material and can run without
   mutating the target or requiring new authority.
3. An isolated disposable copy for commands that may generate build or test
   artifacts, provided required dependencies are already available.
4. A persisted failed or unavailable probe when execution requires dependency
   installation, package restore, service startup, network access, secrets, or
   broader permissions that were not explicitly authorized.

Do not combine network-enabled dependency preparation with repository-code
execution in one automatically elevated command. If a user explicitly
authorizes dependency preparation, keep it separate from the later sandboxed,
offline executable probe. A missing or failed executable probe remains visible
evidence and may affect adequacy, caps, reliability, and token-efficiency
eligibility; it does not by itself justify replacing deterministic scoring with
a failed run.

After recording deterministic verdicts for every recommendation claim, finalize
the fresh orchestrator draft:

```powershell
node bin/waymark.mjs --db <journal> report finalize --run <run-id>
```

Finalization emits the authoritative structured `report.recommendations` event
and fails if any cited claim lacks a latest deterministic verified verdict.

Claim criticalities are `critical`, `high`, `medium`, and `low`. Cite
repository-relative paths and one-based line ranges. Keep assertions atomic.

Verification methods used by scoring are:

- `static_inspection`: deterministic source/config/graph inspection
- `executable_probe`: safe command with captured exit/result evidence
- `independent_model`: supporting model assessment only
- `none`: no usable verification

For each claim, record a final verification. Evidence must include scorer
annotations:

```json
{
  "runId": "<run-id>",
  "claimId": "<claim-id>",
  "verifier": "verifier",
  "method": "static_inspection",
  "verdict": "verified",
  "evidence": {
    "citationStatus": "valid",
    "independentAssessment": "agree",
    "commandOrInspection": "rg …",
    "result": "reproducible concise result"
  }
}
```

`citationStatus` is `valid`, `invalid`, or `missing`.
`independentAssessment` is `agree`, `disagree`, or `not_checked`. Agreement never
changes a deterministic verdict.

Benchmark token phases are `candidate_navigation`, `independent_validation`,
`orchestration`, `deterministic_verification`, and `report_generation`. Sources
are `provider_reported`, `measured`, or `estimated`. Use `measured` for host-side
telemetry collected independently of the audited agent, including Codex JSONL
usage events or persisted rollout counters. Never merge candidate navigation
into validation/report tokens. If no measurement exists, omit the token record
and present the phase as unavailable rather than recording zero.
Only role-process usage belongs in these records. The controlling session's
development, debugging, browser checks, and report discussion are out of scope.
Currency cost is unavailable unless the run records a versioned provider
pricing snapshot; never infer current prices after the fact.
Within an otherwise valid token record, omit optional dimensions the host did
not report. Persist them as unavailable/null, not zero. In particular, do not
invent cache-creation tokens when Codex reports only input, cached-input, and
output usage.

## Record benchmark recommendations

Recommendations connect verified navigation friction to the Practice Guide.
The task or feature request is measurement context only. Recommendations must
improve the repository's navigability, discoverability, ownership signals,
dependency visibility, instructions, or verification paths. They must not
describe how to implement the probed feature.
Append `recommendation.created` before finishing the run with a structured
payload:

```json
{
  "priority": "P1",
  "title": "Expose the native-video ingress ownership path",
  "description": "Link ingress, hashing, cleanup, vendor work, and charging from the owning module.",
  "practiceIds": ["01", "02", "03"],
  "affectedDimensions": ["ownershipClarity", "dependencyClarity"],
  "observedSymptom": "Only 2/4 ownership questions and 3/5 required dependency edges were answered.",
  "tokenMechanism": "One explicit ownership path removes repeated searches for indirect wiring and side effects.",
  "evidence": [{"claimId": "claim-id", "citation": "path/to/file:12"}],
  "effort": null
}
```

Practice IDs are `01` through `07` from the UI guide. A recommendation must
state the observed symptom, repository change, and expected token mechanism.
Effort may be recorded only with a stated basis; otherwise keep it null.

Do not put a model-written point estimate in `gain`, `projectedPoints`, or
similar fields. An optional projection is valid only when a versioned,
deterministic local projector calculates it from a persisted observation
delta:

```json
{
  "projection": {
    "method": "deterministic",
    "version": "waymark-impact/1.0.0",
    "points": 4.25,
    "observationDelta": {"dependencies.requiredEdgesFound": 1}
  }
}
```

Without that record, the UI reports point impact as unavailable. The weighted
distance from a dimension score to 100 is maximum rubric headroom, not a
promised gain and not a token forecast.

### Refine a completed report

Use a post-run evidence review when the original recommendation events do not
tell a developer exactly what to change. The input is a versioned list of
repository-navigation actions with concrete repository changes, validation
checks, known limitations, and references to existing verified claim IDs:

```json
{
  "scope": "repository_navigation",
  "recommendations": [{
    "id": "native-video-map",
    "priority": "P1",
    "title": "Publish the native-video ownership path",
    "problem": "The probe required repeated searches across API, application, and infrastructure projects.",
    "change": "Add a feature map beside the owning application command.",
    "repositoryChanges": [
      "Link the controller, command, handler, external contract, infrastructure adapter, and focused tests."
    ],
    "claimIds": ["verified-claim-id"],
    "practiceIds": ["01", "02", "03"],
    "affectedDimensions": ["discoveryEfficiency", "ownershipClarity"],
    "tokenMechanism": "One indexed path replaces repeated global searches.",
    "validationChecks": [
      "Repeat the same navigation probe and compare files opened, dead ends, relevant locations found, and candidate navigation tokens."
    ],
    "limitations": ["No point gain is projected."],
    "effort": null
  }]
}
```

```powershell
node bin/waymark.mjs --db <journal> report recommend --run <run-id> --input-file <recommendations.json>
```

`report recommend` accepts completed runs only. Each referenced claim must
exist and its latest static or executable verification must be `verified`.
Waymark appends the review to the audit journal and resolves the claim's stored
citations in the UI. The latest review replaces older recommendation actions
in the report presentation.

This command is a report addendum, not rescoring. It cannot change score
events, reliability, observations, or token records. Do not use it to introduce
new factual claims or feature implementation guidance; verify and persist
navigation claims during the audit first.

## Build and persist the benchmark score

Create an observations file from recorded, reproducible counts:

```json
{
  "discovery":{"relevantLocationsFound":0,"relevantLocationsExpected":0,"filesOpened":0,"deadEnds":0},
  "ownership":{"correctAnswers":0,"totalAnswers":0,"ambiguousBoundaries":0},
  "dependencies":{"requiredEdgesFound":0,"requiredEdgesExpected":0,"hiddenEdgesEncountered":0},
  "changeSurface":{"requiredConsumersFound":0,"requiredConsumersExpected":0,"falsePositiveConsumers":0},
  "verification":{"workflowsFound":0,"workflowsExpected":0,"successfulProbes":0,"attemptedProbes":0},
  "instructions":{"applicableRulesFound":0,"applicableRulesExpected":0,"conflictsEncountered":0}
}
```

Then:

```powershell
node bin/waymark.mjs --db <journal> report read --run <run-id> > <report.json>
node .agents/skills/waymark-audit/scripts/build-score-input.mjs --report <report.json> --observations <observations.json> > <score-input.json>
node bin/waymark.mjs --db <journal> score calculate --run <run-id> --input-file <observations.json> --finish
node bin/waymark.mjs --db <journal> report read --run <run-id>
```

The helper previews the same canonical mapping used by the CLI. The scoring
command independently rebuilds that input from SQLite, stores the canonical
input and SHA-256 hash with the authoritative event, and completes the run in
the same transaction. Candidate-provided score fields are never accepted.

To terminate without a score:

```powershell
node bin/waymark.mjs --db <journal> run finish --run <run-id> --status failed --summary-json '{"reason":"…"}'
```
