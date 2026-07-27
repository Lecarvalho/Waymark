# Waymark

Waymark is a local-first audit tool for measuring how efficiently and reliably
coding agents navigate a repository.

The audit request is made in a paired agent session such as Codex or Claude
Code. Waymark records the work and presents the report. The web application is
an observer; it does not prompt or control the agent.

Waymark has two execution contracts:

- `general` runs one most-capable auditor for broad, evidence-led repository
  research. Its weighted result is auditor-assessed from cited evidence.
- `task_specific` and `system_explanation` run the reproducible candidate,
  independent-research, orchestration, deterministic-verification, and scoring
  benchmark pipeline.

## What Waymark measures

- discovery efficiency
- ownership and dependency clarity
- change-surface recall
- verification discoverability
- instruction quality
- measured token usage
- report completeness and reliability

Token efficiency after adequacy gates and authoritative deterministic scoring
apply only to benchmark modes. General audits have no Waymark hard token limit
or token-efficiency score.

Waymark does not score security or general software quality.

## Requirements

- Node.js 22.13 or newer
- A local coding-agent environment

## Local development

```bash
npm install
npm run dev
```

`npm run dev` starts the local SQLite service and the React observer interface.
The default URLs are:

- interface: `http://localhost:3000`
- local service: `http://127.0.0.1:4318`

The SQLite database defaults to `.waymark/waymark.sqlite`. Override it with
`WAYMARK_DB_PATH`.

If a Waymark service is already listening on the configured port and reports
the same database through `/health`, `npm run dev` reuses it instead of starting
another service. If the journal differs, startup stops with an explicit error;
it never creates a replacement database silently.

### Watch a zero-cost live audit replay

With `npm run dev` already running, open the observer interface and run:

```bash
npm run replay:general-live
```

This creates one new run named **[Synthetic replay] Live general audit** in the
journal reported by the service's `/health` endpoint. The observer displays
incremental input, cached-input, uncached-input, output, and processed-token
updates along with tool activity, checkpoint delivery, findings, a finding
revision, dimension assessments, recommendations, and terminal completion.
The harness uses deterministic fixture events: it invokes no model, spends no
provider tokens, and does not read or modify a target repository.

Updates are spaced 650 ms apart by default. Use
`npm run replay:general-live -- --delay-ms 1200` for a slower replay, or
`--delay-ms 0` for automated checks. `--service <url>` selects another running
Waymark service. `--journal <path>` is an optional safety assertion and the
replay stops if it does not match the service's authoritative journal.

## Prepare an audit request

Use the secondary **Prepare audit request** action in the observer interface to
assemble a compact handoff for the paired coding-agent session. It contains only
runtime inputs; the repository-local audit skill supplies the fixed workflow,
safety, and mode-specific assessment or scoring protocol. Provider, model, and
reasoning choices come from the read-only local adapter capability endpoint.
General mode selects one auditor and may set a non-stopping soft usage notice;
benchmark modes select their measured roles and declare phase token targets and
hard limits.

The generated request records the running service URL and its exact SQLite path.
The paired agent must append a new run to that journal and must not start a
second service or create a database for the audit.

General audits declare `Mode: general`, one auditor identity, and
`tokenPolicy: unbounded_by_waymark`. They do not use a benchmark task suite.
Audit names, run policies, protocol versions, and rubric versions are resolved
from the current Waymark checkout instead of being repeated in the prompt.

Opening, editing, or copying a prepared request does not create a run, invoke a
model, or write to SQLite. Only the explicit **Copy audit request** action writes
the generated text to the clipboard.

## Run an audit

Invoke the repository-local skill from a compatible agent:

```text
Use $waymark-audit to audit C:\path\to\target-repo as if you needed to add
partial refunds with manager approval and idempotency.
```

The skill uses the provider-neutral CLI:

```bash
npm run waymark -- help
```

Mutation commands accept JSON with `--input-json`, standard input, or
`--input-file`. Every command emits one JSON line suitable for automation.

After creating a general run with one auditor, launch the single-auditor
workflow:

```bash
npm run waymark -- general audit --run <run-id>
```

The general runner appends validated findings, revisions, behavior paths,
dimension progress, recommendations, and synthesis checkpoints while research
is active. Acknowledged evidence survives provider, service, and UI restarts.
Provider failure or cancellation retains useful cited evidence; incomplete
coverage becomes a `partial` report, while `failed` is reserved for runs with
no usable report evidence. Context continuation uses the persisted ledger and
open coverage rather than inherited operator conversation. Replayed
checkpoints are idempotent, and repeated no-progress activity stops cleanly
without discarding evidence.

General completion is driven by adequate evidence across all six fixed-weight
dimensions. The report shows an `Auditor-assessed` weighted result only when
all dimensions are assessed. Otherwise it shows the exact assessed weight and
leaves missing dimensions `not_assessed`.

For `task_specific` and `system_explanation`, create an active run with
candidate and orchestrator participants (and, normally, an independent
participant), then launch the isolated benchmark investigation:

```bash
npm run waymark -- investigation run --run <run-id>
```

The Codex adapter starts each audited role in a separate ephemeral
assignment-only process with a read-only sandbox. Candidate and independent
roles run in parallel. JSONL tool events and host-measured token usage are
written to the journal as they arrive. The reporting reserve includes both the
current context that a resumed turn must replay and bounded report output; the
fixed final 20% is only a minimum. Reaching that reserve interrupts the full
provider process tree. Waymark then resumes that same session once, without
tools and with a five-minute safety deadline, to retain a structured partial
report. The rescue remains subject to the declared hard token limit. It also
runs when telemetry jumps past the ceiling or an over-budget provider exits
before returning output.

On Windows, Waymark resolves the installed Codex JavaScript entry point instead
of spawning a `.cmd` launcher. Set `WAYMARK_CODEX_ENTRY` or pass
`--codex-entry <path>` if it is installed in a nonstandard location.

Automatic phase targets start from the safe rubric defaults. At least three
same-mode completed samples are required before a lower historical average may
reduce a target; historical usage never raises the automatic default.

## Benchmark roles

Each role runs in a fresh, assignment-only process so its evidence and token
cost remain separate.

- **Candidate:** performs the primary repository investigation. It follows the
  selected navigation probe, records searches and dead ends, and returns cited
  navigation findings plus a separate concise probe answer for validation.
  Candidate confidence is evidence, but the candidate cannot assign a Waymark
  score.
- **Independent researcher:** investigates the same probe independently and in
  parallel with the candidate. It looks for missed owners, consumers,
  dependencies, instructions, and verification paths; challenges unsupported
  claims; and suggests safe deterministic checks. Agreement with the candidate
  supports a claim but does not prove it.
- **Orchestrator:** receives the completed investigations and cross-examines
  their claims. It records disagreements and qualifications, requests
  deterministic verification, and drafts repository-navigation
  recommendations using only supported navigation evidence. It cannot assign
  the authoritative score.

After these roles finish, Waymark verifies the claims and its deterministic
scorer computes the authoritative score and reliability. These roles and that
scorer are never used for a general audit.

## Benchmark reliability model

The candidate never assigns the final score. Waymark derives authority from:

- cited evidence
- independent research
- deterministic or executable verification
- critical-claim coverage
- contradiction and confidence-gap analysis

Missing or contradicted critical evidence caps both the navigability score and
report reliability. Candidate token efficiency is considered only after the
adequacy gate passes.

Verification is repository-appropriate rather than tied to a language or test
runner. Static inspection may fully verify navigation-only claims. Executable
probes run only when they are material and safe; commands that may write use an
isolated disposable copy, and dependency installation, package restore, service
startup, or network access requires separate explicit authorization. An
unavailable probe is recorded as evidence and flows into adequacy, caps, and
token-efficiency eligibility instead of automatically turning an otherwise
complete audit into a protocol failure.

## Project map

```text
app/                         React observer interface
server/                      Local REST and SSE service
src/domain/                  Audit contracts
src/protocol/                Input validation
src/persistence/             SQLite event journal
src/scoring/                 Deterministic scoring and reliability
src/orchestration/           Agent workflow contracts
bin/waymark.mjs              Provider-neutral CLI
.agents/skills/waymark-audit Repository-local audit skill
fixtures/benchmarks/         Controlled calibration cases
```

See `IMPLEMENTATION_PLAN.md` for the milestone sequence and acceptance criteria.

## Validation

```bash
npm test
npm run lint
```

Waymark is designed to remain local. No repository contents or audit records are
uploaded by the application.
