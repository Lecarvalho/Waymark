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
