# Waymark audit protocol

Use file inputs for non-trivial payloads. Every CLI response is one JSON object:
`{"ok":true,"command":"…","data":…}` or `{"ok":false,"error":…}`. Stop on a
nonzero exit status or `ok:false`.

## Create the run

```powershell
node bin/waymark.mjs --db <journal> run create --input-file <run.json>
```

`run.json`:

```json
{
  "targetRepositoryPath": "C:/repos/example",
  "repositoryIdentity": "example",
  "commitSha": "immutable-sha",
  "task": "Trace the change surface for partial refunds",
  "participants": [
    {"role":"orchestrator","provider":"openai","model":"model-id"},
    {"role":"candidate","provider":"openai","model":"model-id"},
    {"role":"independent","provider":"openai","model":"model-id"},
    {"role":"verifier","provider":"local","model":"deterministic"}
  ],
  "toolPolicy": {"target":"read-only","network":"declared"},
  "runConditions": {
    "parallelResearch": true,
    "execution": {
      "isolation": "fresh_process",
      "sessionPersistence": "ephemeral",
      "contextPolicy": "assignment_only",
      "measurementScope": "role_process_only"
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

Participant roles must be unique. Candidate and orchestrator are required.

## Isolated role execution

Audited roles must not inherit the controlling conversation. For Codex, launch
each role as a new non-resumed process with `codex exec --ephemeral --json`,
the target as its working directory, and a read-only sandbox. Pass only the
rendered assignment prompt and required repository instructions. Do not include
operator conversation, Waymark source changes, previous agent traces, or UI
debugging context.

Parse the JSONL stream as it arrives. `turn.completed.usage` supplies input,
cached-input, and output tokens. Cached input is a subset of input, so processed
tokens are `input + output`, not `input + cached input + output`. Persist live
tool events during the turn and the final host-measured usage at completion.

Every run declares the budget object shown above. Interrupt providers that
expose live cumulative usage when a hard limit is reached. Providers that only
report usage at turn completion must append `budget.exceeded` and disqualify
the run when the final value crosses the limit. A single-turn reporting
limitation must never be described as preemptive enforcement.
The target is the efficiency objective; the hard limit is a separately
calibrated validity ceiling. Establish the ceiling before the run from a prior
bounded measurement for the same host/model/task class. Do not raise it after
seeing the current result. Preserve any over-budget attempt as a distinct,
failed, unscored run.

Use a preflight to confirm the exact provider launcher and read-command policy.
On Windows/Node 24, spawning a `.cmd` file directly can fail with `EINVAL`;
launch the provider's JavaScript entry point with `process.execPath`, or use a
known-compatible shell invocation. Narrow file-name discovery and selected-file
searches are more reliable than pipelines or repository-wide matching-line
searches under strict execution policies.

## Journal evidence

```powershell
node bin/waymark.mjs --db <journal> event append --input-file <event.json>
node bin/waymark.mjs --db <journal> claim submit --input-file <claim.json>
node bin/waymark.mjs --db <journal> verification record --input-file <verification.json>
node bin/waymark.mjs --db <journal> token record --input-file <token.json>
```

Recommended event types are `investigation.started`, `search.performed`,
`file.opened`, `dead_end.encountered`, `rule.found`, `answer.recorded`,
`challenge.raised`, `challenge.resolved`, `probe.executed`,
`investigation.completed`, and `investigation.failed`. Event actors and types
beginning with `waymark`, plus `score.*` and `run.finished`, are reserved.
The optional `scripts/emit-event.mjs` helper emits a validated event input JSON
from `--run`, `--actor`, `--type`, `--payload-json`, and optional token flags.

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

Token phases are `candidate_navigation`, `independent_validation`,
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

## Record actionable recommendations

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

## Build and persist the score

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
