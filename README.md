# Waymark

Waymark is a local-first audit tool for measuring how efficiently and reliably
coding agents navigate a repository.

The audit request is made in a paired agent session such as Codex or Claude
Code. Waymark records the work, verifies claims, computes a versioned score, and
presents the report. The web application is an observer; it does not prompt or
control the agent.

## What Waymark measures

- discovery efficiency
- ownership and dependency clarity
- change-surface recall
- verification discoverability
- instruction quality
- token efficiency after adequacy gates
- reliability of the audit itself

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

After creating an active run with candidate and orchestrator participants
(and, normally, an independent participant), launch the isolated investigation:

```bash
npm run waymark -- investigation run --run <run-id>
```

The Codex adapter starts each audited role in a separate ephemeral
assignment-only process with a read-only sandbox. Candidate and independent
roles run in parallel. JSONL tool events and host-measured token usage are
written to the journal as they arrive. A live hard-limit overrun interrupts the
role; Codex completion-only usage is checked immediately afterward and an
overrun fails the run as calibration-ineligible.

On Windows, Waymark resolves the installed Codex JavaScript entry point instead
of spawning a `.cmd` launcher. Set `WAYMARK_CODEX_ENTRY` or pass
`--codex-entry <path>` if it is installed in a nonstandard location.

## Reliability model

The candidate never assigns the final score. Waymark derives authority from:

- cited evidence
- independent research
- deterministic or executable verification
- critical-claim coverage
- contradiction and confidence-gap analysis

Missing or contradicted critical evidence caps both the navigability score and
report reliability. Candidate token efficiency is considered only after the
adequacy gate passes.

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
