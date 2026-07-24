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
   it. Create a run with a concise, human-readable name, the verbatim task,
   candidate and orchestrator identities, declared tool policy, fresh-process
   execution policy, phase token budgets, run conditions, and protocol/rubric
   versions. The name states the probe's intention in at most 72 characters; it
   does not copy the full task.
2. Treat the target repository as read-only. Do not edit, install dependencies,
   format files, generate artifacts, or run commands that write into it. Use only
   safe read-only probes. A future implementation probe requires an explicitly
   disposable worktree outside the target.
3. Run `node bin/waymark.mjs --db <journal> investigation run --run <run-id>`.
   This is the only supported launcher. It dispatches candidate and independent
   roles in parallel, imports the candidate's cited findings as claims, then
   dispatches the orchestrator. All three roles run as fresh, non-resumed
   provider processes with assignment-only context and a read-only sandbox. The
   orchestrator stores challenges, deterministic verification requests, and
   structured recommendation drafts. Never replace this command with subagents
   forked from the controlling conversation or an ad hoc provider command.
   Before paid work, prove the installed Codex JavaScript entry point with a
   no-model preflight; use `--codex-entry <path>` or `WAYMARK_CODEX_ENTRY` when
   automatic Windows discovery is unavailable.
4. Confirm that the runner persisted monotonic stage progress, live tool events,
   completion or failure events, and each role's host-measured tokens in the
   correct phase. Missing telemetry remains unavailable. A blocked command still
   consumes navigation budget. Count only the audited role processes:
   development, debugging, UI checks, and operator conversation never enter the
   run.
5. Review the imported candidate claims and the orchestrator's challenges and
   verification requests. The independent researcher and orchestrator may expose
   missing consumers, hidden dependencies, unsupported certainty, and
   conflicting instructions, but agreement is not proof.
6. Verify every critical claim deterministically where possible. Prefer static
   inspection and safe executable probes. Record `verified`, `contradicted`, or
   `unverified`; never silently drop unresolved claims. Include `citationStatus`
   and `independentAssessment` in verification evidence as described in the
   protocol.
7. Run `node bin/waymark.mjs --db <journal> report finalize --run <run-id>`.
   This deterministically rejects recommendation drafts that cite missing,
   contradicted, or non-deterministically verified claims. A finalized
   recommendation must show the observed problem, exact evidence, a named
   repository-navigation change, its token mechanism, limitations, and a
   repeatable before/after validation check. The feature request remains only a
   probe; never convert the recommendation into feature implementation advice.
8. Create the observation-count JSON from the stored trace and verified answer
   key. Read the stored report, then optionally run
   `node .agents/skills/waymark-audit/scripts/build-score-input.mjs` to assemble
   a preview of the canonical scorer input. Inspect it for traceability.
9. Call `score calculate --finish` with the observation-count JSON. The CLI
   rebuilds canonical scorer input from the persisted report, stores its hash,
   and completes the run atomically. Only the Waymark deterministic scorer may
   emit the authoritative score. Read the stored report and summarize evidence,
   caps, confidence gap, reliability, the declared candidate target, the
   observed candidate-process token total, and their exact efficiency formula.
10. If the completed report's recommendations require a corrected evidence
    review, append a post-run evidence review with `report recommend`. Every action must cite
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
5. Confirm the runner appends `investigation.started` for the candidate and
   independent roles and `orchestration.started` for the orchestrator before
   each launch. Stream observable tool/file/search events into SQLite as the
   JSONL arrives, then verify in the UI that active-role counts, phase, progress,
   and token source are current.
6. After completion, confirm every stored optional token dimension came from
   telemetry. Missing subfields remain unavailable, never zero.

## Authority boundary

Never ask or allow the candidate to assign an overall, dimension, reliability, or
token-efficiency score. Candidate confidence is evidence, not authority.
Candidate-provided scores must not enter scorer input. Deterministic verification
outranks independent agreement, and token efficiency is interpreted only after
adequacy gates pass.
