# Waymark Agent Guide

## Scope

These instructions apply to the entire repository.

## Product

Waymark is a local-first companion for measuring how efficiently and reliably
coding agents navigate a target repository.

- Audit requests originate in a paired coding-agent session such as Codex or
  Claude Code.
- Waymark supports two explicit audit modes:
  - A general repository audit uses a versioned, standardized navigation task
    suite and does not require a user-supplied feature request.
  - A task-specific audit uses a realistic engineering feature request supplied
    for that repository.
- A task-specific feature request is only a navigation probe. The report must
  not advise the user how to implement that feature.
- A general repository audit aggregates navigability evidence from its task
  suite; it is not a general code-quality assessment.
- Report repository-specific changes that improve agent navigability,
  discoverability, ownership clarity, dependency clarity, verification
  discoverability, and token efficiency.
- Waymark observes progress, presents evidence, and preserves reports.
- Waymark may provide a preparation-only modal that generates a copyable audit
  request from user selections. It must not invoke a model, create a run, write
  to the audit journal, or masquerade as a "start audit" action.
- Waymark measures AI coding navigability only. It does not score security,
  correctness, maintainability, accessibility, or general software quality.

The application uses a local SQLite audit journal and a read-only local service.
The interface keeps an explicit demo fallback for machines with no active local
service. Never present fallback values as live measurements.

## Core Invariants

1. The candidate model never assigns its own final score.
2. Keep candidate confidence, candidate performance, and audit reliability as
   separate measurements.
3. Deterministic verification and executable evidence outrank model agreement.
4. Two agents agreeing is supporting evidence, not proof.
5. Unverifiable claims remain explicitly `unverified`.
6. Token efficiency is meaningful only after an adequacy or correctness gate.
7. Record the repository commit, task or versioned task suite, audit mode, model
   identity, tool policy, rubric version, and run conditions with every audit.
8. Separate candidate navigation tokens from validation and report-generation
   tokens.
9. Provider-reported, host-measured, estimated, and unavailable token values
   must be labeled distinctly.
10. The target repository is read-only. Use an explicitly disposable worktree
    for any future implementation probe.
11. Audited model roles run in fresh processes with assignment-only context;
    never inherit the controlling development conversation.
12. Every run declares phase token targets and hard limits. A hard-limit
    overrun is visible and disqualifies the run as a successful benchmark.
13. Count only role-process work in the audit. Waymark development, debugging,
    UI verification, and operator conversation belong outside the run.

## Stack

- React 19 and Next-compatible APIs through Vinext
- TypeScript
- Tailwind CSS import with project-specific CSS in `app/globals.css`
- Node's built-in SQLite module for the local audit journal
- A read-only local REST and server-sent events service
- Node.js 22.13 or newer

## Repository Map

- `app/page.tsx`: current dashboard, run history, and static practice guide
- `app/globals.css`: the complete Waymark visual system and responsive layout
- `app/layout.tsx`: metadata, fonts, and root document structure
- `app/use-waymark-live.ts`: local-service connection and demo fallback
- `PRODUCT.md`: product purpose, users, commitments, and anti-goals
- `DESIGN.md`: canonical visual language and interface constraints
- `IMPLEMENTATION_PLAN.md`: milestone contracts and acceptance criteria
- `server/waymark-server.mjs`: read-only local REST and SSE service
- `src/domain/`: provider-neutral audit contracts
- `src/protocol/`: strict input validation
- `src/persistence/`: append-only SQLite journal
- `src/scoring/`: deterministic scorer and reliability gates
- `src/orchestration/`: agent workflow contracts
- `bin/waymark.mjs`: stable JSON command-line protocol
- `.agents/skills/waymark-audit/`: repository-local audit skill
- `fixtures/benchmarks/`: controlled calibration cases
- `tests/rendered-html.test.mjs`: rendered application smoke test
- `public/og.png`: Waymark social-preview asset

## Commands

Use the repository scripts as the canonical interface:

```bash
npm install
npm run dev
npm run dev:web
npm run dev:service
npm run build
npm test
npm run lint
npm run waymark -- help
```

- Run `npm run build` after UI or application changes.
- Run `npm test` after protocol, persistence, scoring, service, rendered
  content, routing, or server changes.
- Run `npm run lint` for TypeScript or React changes when practical.

## Architecture Direction

Keep these boundaries when implementing the real application:

```text
Repository-local audit skill
        ↓
Provider-neutral CLI and normalized audit events
        ↓
Run orchestration and claim ledger
        ↓
Deterministic verification and scoring
        ↓
SQLite persistence
        ↓
Read-only local REST/SSE service
        ↓
React observer interface
```

- UI components and the local service must not invoke models or calculate
  authoritative scores.
- Agent-provider details belong behind adapters.
- Expose provider, model, and reasoning-effort choices through read-only adapter
  capability declarations. Do not hardcode them in React components.
- Persist normalized domain records, not provider-specific response objects.
- Scoring formulas must be versioned, reproducible, and independent from
  report prose.
- Append audit progress to an event journal before projecting it into the UI.
- Keep the local HTTP service read-only. Mutations go through the CLI.
- Reserve authoritative score events for the deterministic scoring command.

## Data Model Expectations

Future persisted records should distinguish at least:

- repositories and analyzed commits
- audit tasks and task suites
- runs and run conditions
- participating models and roles
- observable events and tool activity
- claims, citations, challenges, and verdicts
- verification coverage and executable-probe results
- provider and canonical token measurements
- score dimensions, gates, rubric versions, and recommendations

Do not collapse raw evidence into only a final score. Historical comparisons
must remain explainable from stored run data.

## UI Conventions

- Read `PRODUCT.md` and `DESIGN.md` before changing the product interface.
- Preserve the dark graphite control-room aesthetic and signal colors defined
  in `app/globals.css`.
- Lime means active, connected, or verified; amber means disputed or pending;
  red means contradicted or failed; blue identifies candidate measurements.
- Keep the first viewport focused on the active audit, not generic dashboard
  navigation.
- The dashboard remains observer-only. Browsing history, pausing a visual
  stream, inspecting evidence, and preparing a copyable audit request are
  acceptable. Creating a run or invoking an audited role from the UI is not.
- Keep “Prepare audit request” secondary to the active audit and implement it
  as an accessible modal. Its output must be self-contained, visibly
  preparation-only, and copied only after an explicit user action.
- Keep model identity, token usage, reliability, verification coverage, and
  mock/live status visible.
- Preserve keyboard-accessible native controls and responsive behavior.
- Avoid unnecessary imagery, external fonts, CDNs, and decorative animation.
- Do not remove or weaken the static Practice guide without an explicit product
  decision.

## Code Conventions

- Prefer small typed components and named domain structures over anonymous
  object shapes.
- Move mock data out of the page component when real data integration begins.
- Avoid generic modules named `utils`, `helpers`, `common`, or `manager`.
- Keep provider adapters, scoring, persistence, and presentation in separate
  modules.
- Do not add secrets, tokens, repository contents, or sensitive source snippets
  to committed fixtures.

## Definition of Done

A change is complete when:

- It preserves the product boundaries and scoring invariants above.
- Mock and live data remain clearly distinguishable.
- Relevant states include loading, empty, active, complete, and failed behavior
  when applicable.
- The production build succeeds.
- Relevant tests pass.
- User-facing copy accurately describes what has and has not been verified.
