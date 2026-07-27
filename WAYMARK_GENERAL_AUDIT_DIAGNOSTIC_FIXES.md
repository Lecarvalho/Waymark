# Waymark General-Audit Diagnostic Fixes

Status: implementation handoff
Scope: Waymark only
Observed: 2026-07-27
Reference run: `18133f70-4732-4c49-b87c-6883aaf1d973`

## Purpose

This document captures the Waymark product and protocol improvements exposed by
the first complete live general audit. It is intended to be implemented in a
fresh development session.

Clapline was the read-only diagnostic target. Do not change Clapline while
implementing this handoff. Repository-specific examples below explain what
Waymark failed to communicate or assess; they are not authorization to modify
the target repository.

## Observed run

The run completed with:

- one read-only `gpt-5.6-sol` auditor
- auditor-assessed result `80.79/100`
- all six dimensions assessed at 100% total weight
- 9 semantic findings
- 3 recommendations
- 31 acknowledged semantic checkpoints
- 8 rejected semantic checkpoints
- 38 completed, 4 declined, and 15 failed provider tools
- 5,470,992 measured processed tokens
  - 5,452,740 input
  - 5,246,071 cached input
  - 206,669 uncached input
  - 18,252 output
- a permanently `Degraded` observation-channel badge despite recovered
  semantic delivery and a completed report
- no projected seven-principle Practice Guide profile, even though findings
  carried Practice Guide tags

The run produced valid evidence, but it exposed gaps in checkpoint ergonomics,
report semantics, UI communication, Practice Guide coverage, recommendation
coverage, observer discovery, and operational token safeguards.

## Product principles to preserve

- The dashboard remains observer-only. It must not invoke models or create runs.
- General-mode results remain `auditor_assessed`, never authoritative or
  deterministic.
- General mode has no hard token limit and no token-efficiency score.
- Candidate confidence, provider/tool health, checkpoint delivery, report
  completeness, and audit result remain separate measurements.
- Documentation alone cannot support code-structure, ownership, dependency,
  behavior-organization, naming, or test-mirroring conclusions.
- Missing Practice Guide evidence becomes `not_assessed`; it never becomes a
  favorable default or a zero.
- Do not manufacture more recommendations merely to match token spend or
  finding count.

---

## P0 — Distinguish finding state from finding polarity

### Problem

The Evidence tab renders every durable finding with a green `Confirmed` label.
This makes strengths and navigation friction look identical.

In the observed report:

- “Backend dependency direction is explicit and executable” is a positive
  finding.
- “Production save ownership is split behind overlapping generic names” is a
  friction finding.
- Both appear as green `Confirmed`.

`confirmed` describes the revision state. It does not mean the finding is good.
The domain already stores a separate signal such as `positive` or `friction`,
but the presentation hides it.

### Required change

Render revision state and semantic polarity independently.

Suggested user-facing vocabulary:

| Domain value | User-facing label | Meaning |
| --- | --- | --- |
| `positive` | Strength | Repository organization reduced navigation cost |
| `friction` | Needs attention | Repository organization increased navigation cost |
| provisional/unresolved state | Unresolved | Evidence is incomplete |
| contradicted/retracted state | Contradicted or retracted | Later evidence changed the conclusion |

Each evidence row must show both concepts when relevant, for example:

- `Confirmed · Strength`
- `Confirmed · Needs attention`
- `Provisional · Unresolved`

Add a strong non-color cue: icon, text label, left rule, or compact badge.
Color alone is insufficient. Preserve the existing Waymark signal-color
semantics. If red remains reserved for failed or contradicted outcomes, use an
approved friction-specific warm color plus an attention icon and text. Update
`DESIGN.md` before introducing a new semantic color token.

Filtering or grouping by `All`, `Strengths`, `Needs attention`, and `Unresolved`
is desirable once the basic distinction is present.

### Acceptance criteria

- A positive confirmed finding and a friction confirmed finding are visibly and
  accessibly distinguishable without opening either row.
- `Confirmed` is never the only semantic label on a finding row.
- Screen-reader text includes both revision state and signal.
- Sorting by checkpoint sequence continues to preserve the evidence-learning
  timeline.
- Existing finding revisions remain immutable and visible.
- Rendered HTML tests cover positive, friction, provisional, contradicted, and
  retracted examples.

### Likely owners

- `app/general-audit-view.tsx`
- `app/general-audit-view.module.css`
- `app/general-audit-channel.module.css`
- `app/use-waymark-live.ts`
- `server/general-audit-snapshot.mjs`
- `DESIGN.md`

---

## P0 — Persist and render a repository-specific seven-principle profile

### Problem

The Practice Guide currently presents generic good/bad examples, while the
completed general report does not expose a repository-specific assessment for
each principle.

The general auditor tagged findings with principle identifiers, but that is not
the same as assessing all seven principles. The service projector only
recognizes `report.practice_profile` events produced by the benchmark reporter,
so the new general run was incorrectly presented as predating profile support.

This creates two user-facing failures:

1. Generic guide examples can be mistaken for observed facts about the audited
   repository.
2. A user cannot tell which principles the repository follows, partially
   follows, violates, or lacked enough evidence to assess.

### Required contract

Add a general-audit semantic checkpoint for Practice Guide assessment. Prefer
one of:

- `general.practice.assessed` emitted once per principle, or
- `general.practice_profile.completed` containing exactly seven ordered items.

Each principle assessment must contain:

- canonical principle ID and title
- assessment state: `strong`, `mixed`, `weak`, or `not_assessed`
- concise repository-specific assessment
- supporting positive finding IDs
- supporting friction finding IDs
- limitations
- explicit navigation-token mechanism
- recommendation IDs when action is proposed

Use one canonical mapping between the named general-audit IDs and UI IDs
`01`–`07`. Do not maintain two independent catalogs.

The general ledger and report projector—not the benchmark reporter—must own the
general-mode profile.

### Completion behavior

- Every general run must record one disposition for every principle.
- `not_assessed` is valid only with an explicit evidence limitation.
- If required principle coverage is inadequate, the runner must not silently
  present a complete profile.
- Decide in the versioned general-audit contract whether missing required
  principle coverage makes the run `partial`. Document and test that decision.
- A new general run must never display “this report predates support” merely
  because the general runner uses a different event family from benchmark mode.

### UI behavior

When a general report is selected, the Practice Guide should show:

- the static principle and its generic good/bad teaching example
- a clearly separate “Assessment for `<repository>`” block
- `Strong`, `Mixed`, `Weak`, or `Not assessed`
- linked positive and friction findings
- linked recommendations
- limitations and unknowns

Static examples must be labeled as examples. They must never be presented as
repository evidence.

### Acceptance criteria

- A completed or partial general report projects exactly seven principle items.
- Each item links only to findings that explicitly reference that principle.
- Source/test citations support code-organization judgments.
- The generic Practice Guide remains available when no report is selected.
- A current general run never receives the legacy “predates profile support”
  message.
- History preserves profiles by run, commit, rubric version, and report schema.

### Likely owners

- `src/domain/general-audit.mjs`
- `src/domain/general-audit.d.mts`
- `src/protocol/validation.mjs`
- `src/persistence/audit-store.mjs`
- `src/reporting/general-audit-report.mjs`
- `src/reporting/general-audit-report.d.mts`
- `src/orchestration/waymark-checkpoint-mcp.mjs`
- `src/orchestration/general-auditor-template.mjs`
- `src/orchestration/general-audit-runner.mjs`
- `server/report-content-snapshot.mjs`
- `server/run-snapshot.mjs`
- `app/benchmark-audit-view.tsx` or a general-mode Practice Guide component

---

## P0 — Make each Practice Guide principle an explicit research obligation

### Problem

Listing the seven principles in the assignment did not force the auditor to
perform a cited repository-specific check for each one. Tags attached to
findings are insufficient.

The observed run spent 5.47M processed tokens yet returned only three friction
findings and three recommendations. Positive findings should not be converted
into artificial recommendations, but the run should have explicitly tested
every principle before declaring complete.

The user specifically identified likely missed or under-explained concerns in:

- `01` Organize around behavior
- `03` Name files for the concept they own
- `04` Provide one canonical workflow

### Required research behavior

Add a principle coverage ledger to the continuation context and completion
gate. For each principle, the auditor must record:

- surfaces inspected
- cited positive evidence
- cited friction
- unknown or uninspected nodes
- resulting assessment

Do not require one negative finding per principle. Require a defensible
disposition.

### Canonical-workflow requirement

For principle `04`, the auditor must enumerate the repository’s actual
documented and executable workflow entry points, including applicable:

- root README commands
- package scripts
- CI workflow commands
- developer wrapper scripts
- stack-specific verification harnesses
- agent instructions

Then determine whether those entry points:

1. converge on one canonical underlying workflow,
2. are intentional wrappers with equivalent semantics, or
3. conflict in package manager, command, scope, or verification behavior.

A pattern such as:

```text
README: npm test
CI: pnpm run test:ci
Developer script: yarn verify
Package: ./check-new.sh
```

is only repository evidence when those exact commands are cited from the target.
The static Practice Guide example is not proof that the target has this problem.

For principles `01` and `03`, require representative path evidence that connects
behavior names and concept-owning files to entry points, owners, consumers, and
tests. A global filename search by itself is inadequate.

### Acceptance criteria

- The report explains why each principle is strong, mixed, weak, or not
  assessed.
- Principle `04` records the discovered workflow entry points and whether they
  converge.
- Multiple wrappers are not automatically treated as conflicting.
- Conflicting package managers or semantically different verification paths are
  recorded as friction with citations.
- Completion and continuation prompts expose remaining principle coverage.

---

## P0 — Make MCP checkpoint tools difficult to call incorrectly

### Problem

The single `record` MCP tool exposes a top-level discriminated `oneOf`, with
nested `oneOf` path nodes. The auditor repeatedly guessed the behavior-path
shape and generated eight rejected checkpoints.

Observed errors included:

- invalid `entryPoint.status`
- an unsupported `entryPoint.summary`
- an empty `entryPoint.label`
- malformed `dependencies`
- malformed `consumers`

The channel worked; the payloads were invalid. The tool contract was technically
strict but operationally difficult for the model to use.

### Required change

Prefer event-specific MCP tools with shallow input schemas:

- `record_surface`
- `record_behavior_path`
- `record_finding`
- `revise_finding`
- `record_dimension_progress`
- `assess_dimension`
- `assess_practice`
- `record_recommendation`
- `complete_synthesis`

If the single-tool design is retained, add complete valid examples and explicit
field descriptions to every branch. In either design:

- known path nodes require `status`, `label`, and at least one citation
- unknown path nodes require `status`, `label`, `reason`, and zero citations
- arrays must be described as arrays of nodes, not generic objects
- rejection responses must include the semantic type, exact invalid path, and a
  concise expected shape
- the auditor prompt must show a complete valid behavior-path example

The runner should continue to persist rejected attempts diagnostically without
guessing or repairing semantic content on the model’s behalf.

### Acceptance criteria

- The fake provider can complete all checkpoint types without schema guessing.
- A behavior-path checkpoint succeeds on its first valid call.
- An invalid call receives a bounded actionable error.
- Retrying a rejected idempotency key remains safe.
- Structured-output recovery does not duplicate already acknowledged live
  checkpoints.
- Tests cover every MCP tool schema and rejection path.

### Likely owners

- `src/orchestration/waymark-checkpoint-mcp.mjs`
- `src/orchestration/checkpoint-transport.mjs`
- `src/orchestration/general-auditor-template.mjs`
- `src/orchestration/general-audit-output.schema.json`
- `tests/orchestration.test.mjs`

---

## P1 — Separate semantic-delivery health from provider-tool outcomes

### Problem

The Observation channel becomes permanently `Degraded` when any checkpoint is
rejected, any provider error occurs, or any provider tool is declined or exits
nonzero. A later acknowledged checkpoint does not recover the badge.

This collapses distinct facts:

- semantic evidence delivery
- provider command compatibility
- expected search misses
- historical rejected payloads
- current transport health
- terminal report completeness

The completed run had 31 acknowledged checkpoints after its rejected calls, but
the primary badge remained `Degraded`.

### Required projection

Expose at least two independent statuses:

1. **Semantic delivery**
   - waiting
   - healthy
   - recovered
   - failed
2. **Provider/tool diagnostics**
   - clean
   - warnings
   - failed/interrupted

`recovered` should apply when a rejection occurred and a later semantic
checkpoint was acknowledged. A terminal completed report with a final
acknowledgement must not imply that durable delivery is currently broken.

Keep historical counters visible. Do not erase rejected or failed events.

### Exact error selection

The generic provider completion `mcp tool call failed` currently follows and
masks the more useful `provider.checkpoint.rejected` error.

Coalesce paired events or prefer the structured checkpoint rejection when
present. Display:

- semantic type
- invalid field path
- validation message
- sequence

Provider command failures should be shown separately from checkpoint-delivery
failures.

### Expected search misses

Do not let an expected `rg`/search exit indicating “no matches” imply that
semantic delivery is degraded. Preserve the command outcome as activity, but
classify it separately from transport or protocol failure.

### Acceptance criteria

- Rejection followed by acknowledgement projects semantic delivery as
  `recovered`.
- A completed report with durable synthesis never displays a delivery-failed
  message.
- Historical warning counts remain visible.
- The UI displays the structured rejection error instead of the generic paired
  MCP failure.
- Tool warnings never overwrite report-completeness status.

### Likely owners

- `server/general-audit-snapshot.mjs`
- `server/run-snapshot.mjs`
- `app/page.tsx`
- `app/general-audit-channel.module.css`
- `app/use-waymark-live.ts`
- `tests/general-audit-service-projection.test.mjs`

---

## P1 — Improve read-only auditor command compatibility

### Problem

The read-only auditor attempted complex PowerShell loops and otherwise harmless
commands such as `git ls-files`; several were blocked by policy. It eventually
adapted, but the failures consumed tokens and polluted the observation-channel
status.

### Required change

Add an explicit read-only command recipe to the general assignment:

- prefer `rg --files`
- prefer one narrow `rg -n` query over selected files
- prefer direct `Get-Content` reads
- avoid PowerShell arrays, loops, dynamic command construction, pipelines that
  obscure targets, and cross-shell composition
- use the injected Git safe-directory configuration
- treat search exit `1` with no matches as evidence, not a reason to repeat the
  same query
- split large reads into bounded, independently useful probes

The no-model preflight should report the exact sandbox, approval policy, Codex
entry point, output schema, checkpoint server, and injected safe directory as
one reusable diagnostic object.

Do not broaden the target sandbox or silently switch a `read_only` run to full
access.

### Acceptance criteria

- The standard read-only fixture completes without policy-blocked complex shell
  commands.
- Target mutations, installs, formatting, and generated artifacts remain
  prohibited.
- Command-policy warnings remain separate from semantic-delivery health.

---

## P1 — Require a disposition for every actionable friction finding

### Problem

Recommendation count alone does not explain report coverage. The observed run
had three friction findings and three recommendations, but the UI did not show
that relationship. More importantly, future reports may contain friction that
is intentionally consolidated, deferred, limited, or left without enough
evidence.

Token spend must not create a recommendation quota. Positive findings normally
need no action.

### Required change

Every current confirmed friction finding must have one explicit disposition:

- covered by recommendation `<id>`
- consolidated into recommendation `<id>`
- accepted limitation with reason
- deferred because evidence is insufficient
- retracted or contradicted by a later revision

Every `mixed` or `weak` Practice Guide assessment must link to:

- at least one recommendation, or
- an explicit limitation/deferment explaining why action is not proposed.

Project recommendation coverage:

- current friction findings
- covered friction findings
- deferred/limited friction findings
- recommendations with evidence
- orphan recommendations

Do not require one recommendation per finding; consolidation is desirable when
one repository-navigation change addresses several findings.

### Acceptance criteria

- The Recommendations tab explains why its count differs from the friction
  finding count.
- No recommendation cites positive-only evidence as a problem.
- No current friction finding disappears without a disposition.
- Recommendation titles, rationale, token mechanism, affected dimensions,
  Practice Guide principles, validation check, and limitations are visible.

---

## P1 — Add operational token safeguards without scoring general mode

### Problem

The authorized run was explicitly `unbounded_by_waymark` with no soft usage
notice and consumed 5.47M processed tokens. Most input was cached, but the
processed-token cost and repeated tool/schema retries were still substantial.

The behavior matched the requested policy. This is not a hard-limit violation.
It is an operational usability problem.

### Required change

- Make a non-stopping soft usage notice the recommended default in the
  preparation dialog.
- Derive the default from a versioned policy or compatible historical runs;
  document its basis.
- Preserve `none` as an explicit user choice.
- Show processed, input, cached input, uncached input, and output separately.
- Notify at meaningful cumulative milestones without stopping or invalidating
  the run.
- Attribute token snapshots to semantic checkpoint sequence so report readers
  can see the cost between durable evidence additions.
- Expose descriptive post-adequacy diagnostics such as tokens per accepted
  checkpoint or finding, clearly labeled as cost observations—not a
  token-efficiency score.
- Extend the no-progress circuit breaker to detect high marginal token cost
  without new semantic evidence.
- Reduce retry overhead through the typed MCP and command-guidance fixes above.

Do not introduce a hidden hard limit, automatic cancellation, or general-mode
efficiency score.

### Acceptance criteria

- The prepared request visibly states the soft notice or explicit `none`.
- Crossing a soft notice persists an observable non-terminal event.
- A soft notice never changes validity, score, or terminal outcome.
- Final token totals come from one measured final record; unavailable optional
  dimensions remain null.
- Cost diagnostics appear only after adequacy/completeness is known.

### Likely owners

- `app/prepare-audit-dialog.tsx`
- `src/orchestration/prepare-audit-request.mjs`
- `src/orchestration/prepare-audit-request.d.mts`
- `src/orchestration/general-audit-runner.mjs`
- `server/token-usage-snapshot.mjs`
- `server/general-audit-snapshot.mjs`
- `app/general-audit-view.tsx`

---

## P1 — Make observer discovery and run identity explicit

### Problem

The prepared request contains the service URL but not the observer URL. The
audit protocol requires confirming the intended run in the UI before paid work.
Vinext may select a fallback web port when its preferred port is occupied, so
guessing the observer URL is unreliable.

The UI also showed repository, commit, and model but not the full run ID in the
main live view.

The observed `3000`/`3001` confusion was partly an operator diagnostic mistake:
the first listener check omitted the actual fallback/IPv6-bound web listener.
Waymark still should make discovery deterministic.

### Required change

- Include `Observer: <window.location.origin>` in prepared audit requests.
- Display and copy the full run ID in the live report header.
- Keep the service URL and expected journal as the authoritative data pair.
- Treat the observer URL as a UI-verification aid, not database authority.
- Preserve Vinext’s fallback-port behavior unless the product explicitly
  chooses strict-port startup.
- Document that `npm run dev` starts both observer and service, while
  `npm run dev:web` and `npm run dev:service` start only one side.

### Acceptance criteria

- A copied request contains target, observer URL, service URL, journal, mode,
  participants, permission mode, and token policy.
- A fresh operator can open the exact observer URL without port guessing.
- The UI exposes the exact run ID before role launch.
- The service journal mismatch check remains authoritative.

### Likely owners

- `app/prepare-audit-dialog.tsx`
- `src/orchestration/prepare-audit-request.mjs`
- `src/orchestration/prepare-audit-request.d.mts`
- `app/general-audit-view.tsx`
- `scripts/dev.mjs`
- `README.md`

---

## Implementation order

### Phase 1 — Domain and persistence

1. Define the general Practice Guide assessment/profile contract.
2. Add protocol validation and append-only persistence.
3. Add friction-disposition and recommendation-coverage structures.
4. Version the general-audit contract/report schema if required.

### Phase 2 — Auditor and checkpoint channel

1. Replace or simplify the generic MCP checkpoint tool.
2. Add complete valid examples.
3. Add principle coverage to assignments and continuation context.
4. Add safe read-only command guidance.
5. Require seven principle dispositions before synthesis.

### Phase 3 — Service projections

1. Project finding signal separately from revision state.
2. Project general Practice Guide assessments.
3. Split semantic delivery from provider-tool diagnostics.
4. Prefer exact structured rejection messages.
5. Project recommendation coverage and token-cost diagnostics.

### Phase 4 — Observer UI

1. Add Strength/Needs attention/Unresolved evidence markers.
2. Add repository-specific Practice Guide results.
3. Add recommendation coverage.
4. Add exact run ID and observer URL handling.
5. Add accessible states and responsive behavior.

### Phase 5 — Operational safeguards

1. Add recommended soft usage notices.
2. Persist notice events.
3. Add marginal token/no-progress diagnostics.
4. Update the preparation-only copy and documentation.

---

## Verification plan

Run:

```powershell
npm run lint
npm test
```

`npm test` already includes the production build.

Add or update tests for:

- every MCP checkpoint schema
- first-attempt valid behavior-path persistence
- actionable structured rejection errors
- rejection followed by acknowledgement projecting `recovered`
- provider command warnings not degrading semantic delivery
- positive and friction findings rendering differently
- accessibility without color-only meaning
- exactly seven general Practice Guide dispositions
- principle `04` workflow enumeration and convergence assessment
- missing principle evidence becoming `not_assessed`
- friction disposition and recommendation coverage
- current general reports never receiving the legacy “predates profile” message
- prepared requests containing observer URL and full runtime inputs
- run ID visibility
- soft usage notice persistence without stopping
- token optional-field null behavior
- replay fixture containing strengths, friction, a rejected checkpoint,
  recovery, all seven principle assessments, and consolidated recommendations

Relevant suites include:

- `tests/general-audit-domain.test.mjs`
- `tests/general-audit-persistence.test.mjs`
- `tests/general-audit-report.test.mjs`
- `tests/general-audit-service-projection.test.mjs`
- `tests/general-live-replay.test.mjs`
- `tests/orchestration.test.mjs`
- `tests/preparation.test.mjs`
- `tests/read-only-service.test.mjs`
- `tests/rendered-html.test.mjs`

## Definition of done

- Findings communicate both evidence state and whether they are strengths or
  friction.
- The selected repository has a cited assessment for all seven Practice Guide
  principles.
- Generic guide examples cannot be mistaken for target evidence.
- Canonical-workflow assessment checks real README, CI, package, script, and
  instruction entry points.
- Every current friction finding has an explicit recommendation disposition.
- Observation-channel health no longer conflates recovered semantic delivery
  with historical command warnings.
- MCP rejection messages are actionable and behavior-path recording works
  without iterative schema guessing.
- Prepared requests identify both observer and service.
- General token use is measured and guarded by non-stopping notices without
  introducing an efficiency score or hidden ceiling.
- The dashboard remains read-only and does not invoke models.
- Production build, lint, and relevant tests pass.

## Suggested fresh-session request

> Implement `WAYMARK_GENERAL_AUDIT_DIAGNOSTIC_FIXES.md` in priority order.
> Preserve Waymark’s general-audit authority, read-only dashboard, scoring, and
> token-policy invariants. Do not modify the audited Clapline repository. Start
> with the domain/profile and MCP contracts, then service projections and UI.
> Run lint and the full test suite before handing off.
