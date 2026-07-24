---
name: waymark-audit
description: Run an evidence-backed Waymark audit of a local repository for a realistic engineering task. Use when Codex or another coding agent must measure repository navigability, record candidate and independent investigation through the Waymark CLI, verify claims, account for tokens, and persist a deterministic scored report.
---

# Waymark audit

Read [references/protocol.md](references/protocol.md) before starting. Run commands
from the Waymark repository and use `node bin/waymark.mjs`; add `--db <path>` when
the default journal is not appropriate.

## Workflow

1. Resolve the target's immutable repository identity and commit without changing
   it. Create a run with the task, candidate and orchestrator identities, declared
   tool policy, fresh-process execution policy, phase token budgets, run
   conditions, and protocol/rubric versions.
2. Treat the target repository as read-only. Do not edit, install dependencies,
   format files, generate artifacts, or run commands that write into it. Use only
   safe read-only probes. A future implementation probe requires an explicitly
   disposable worktree outside the target.
3. Run `node bin/waymark.mjs --db <journal> investigation run --run <run-id>`.
   This is the only supported investigation launcher. It dispatches candidate
   and independent roles in parallel as fresh, non-resumed provider processes
   with assignment-only context and a read-only sandbox. Never replace it with
   subagents forked from the controlling conversation or an ad hoc provider
   command. Before paid work, prove the installed Codex JavaScript entry point
   with a no-model preflight; use `--codex-entry <path>` or
   `WAYMARK_CODEX_ENTRY` when automatic Windows discovery is unavailable.
4. Confirm that the runner persisted live tool events, completion or failure
   events, and each actor's host-measured tokens in the correct phase. Missing
   telemetry remains unavailable. A blocked command still consumes navigation
   budget. Count only the audited role process: development, debugging, UI
   checks, and operator conversation never enter the run. Append later
   cross-examination and verification events through the main Waymark CLI.
5. Submit the candidate's material findings as claims with exact repository-relative
   citations, confidence, and criticality. The independent researcher challenges
   missing consumers, hidden dependencies, unsupported certainty, and conflicting
   instructions.
6. Cross-examine disagreements. Append the challenge and resolution as events;
   never treat model agreement as proof.
7. Verify every critical claim deterministically where possible. Prefer static
   inspection and safe executable probes. Record `verified`, `contradicted`, or
   `unverified`; never silently drop unresolved claims. Include `citationStatus`
   and `independentAssessment` in verification evidence as described in the
   protocol.
8. Create evidence-linked recommendation events from the verified navigation
   symptoms. The feature request is only a probe: never recommend how to
   implement it. Recommend repository-level changes to structure, naming,
   documentation, ownership boundaries, dependency visibility, instructions,
   or verification discoverability. Map each recommendation to the applicable
   Practice Guide IDs, affected score dimensions, and the mechanism by which it
   should reduce navigation tokens. Do not let a model invent projected points.
   Include a projection only when a versioned deterministic projector
   calculated it from an explicit observation delta; otherwise leave impact
   and effort unavailable with their reason.
9. Create the observation-count JSON from the stored trace and verified answer
   key. Read the stored report, then optionally run
   `node .agents/skills/waymark-audit/scripts/build-score-input.mjs` to assemble
   a preview of the canonical scorer input. Inspect it for traceability.
10. Call `score calculate --finish` with the observation-count JSON. The CLI
   rebuilds canonical scorer input from the persisted report, stores its hash,
   and completes the run atomically. Only the Waymark deterministic scorer may
   emit the authoritative score. Read the stored report and summarize evidence,
   caps, confidence gap, reliability, the declared candidate target, the
   observed candidate-process token total, and their exact efficiency formula.
11. If the completed report's recommendations are too generic, append a
    post-run evidence review with `report recommend`. Every action must cite
    existing deterministically verified claim IDs and identify exact
    repository-navigation changes, validation checks, and known limits. Do not
    turn the probe into a feature implementation plan. This addendum refines
    the report narrative only; it never changes scores, reliability, or token
    records.

If a phase exceeds its declared hard token limit, append `budget.exceeded` with
the measured breakdown and finish the run as failed or calibration-ineligible.
If orchestration otherwise cannot continue, append a failure event and finish
the run as `failed` or `cancelled`; do not manufacture missing evidence.
Keep failed calibration attempts as separate unscored runs. Never reuse their
context or silently raise a hard limit after observing the result.

## Fresh-session preflight

Before the next audit:

1. Confirm the target path, mode (`general` or `feature`), immutable commit, and
   clean read-only status.
2. Start the local observer and verify its SQLite and SSE endpoints before
   launching roles.
3. Confirm the provider launcher, JSONL usage event, output schema, read-only
   sandbox, and allowed read-command shapes with a cheap preflight.
4. Declare efficiency targets separately from calibrated validity ceilings.
   Targets express desired cost; hard ceilings must be chosen from a prior
   bounded measurement for that host/model/task class and stay fixed for the
   run.
5. Append each role's `investigation.started` event before launch. Stream
   observable tool/file/search events into SQLite as the JSONL arrives, then
   verify in the UI that active-role counts, phase, and token source are current.
6. After completion, confirm every stored optional token dimension came from
   telemetry. Missing subfields remain unavailable, never zero.

## Authority boundary

Never ask or allow the candidate to assign an overall, dimension, reliability, or
token-efficiency score. Candidate confidence is evidence, not authority.
Candidate-provided scores must not enter scorer input. Deterministic verification
outranks independent agreement, and token efficiency is interpreted only after
adequacy gates pass.
