---
name: waymark-audit
description: Run an evidence-backed Waymark audit of a local repository using a general, task-specific, or system-explanation navigation probe. Use when Codex or another coding agent must measure repository navigability, record candidate and independent investigation through the Waymark CLI, verify claims, account for tokens, and persist a deterministic scored report.
---

# Waymark audit

Read [references/protocol.md](references/protocol.md) before starting. Run commands
from the Waymark repository and use `node bin/waymark.mjs`; add `--db <path>` when
the default journal is not appropriate.

## Prepared request contract

Requests copied from the Waymark observer intentionally contain only runtime
inputs. Treat this skill and its protocol as authoritative for fixed workflow,
safety, persistence, and scoring behavior; do not require the copied request to
repeat those rules.

Resolve omitted fixed metadata as follows:

- `general` mode selects
  [waymark-general-navigation@2.0.0](references/general-navigation-suite-2.0.0.json).
  Read that suite, persist its ID and version in `runConditions.taskSuite`, and
  use its ordered practice probes, orientation questions, assessment contract,
  sampling rules, and constraints as the verbatim run probe. General mode
  returns a verified seven-principle agent-readiness profile and a prioritized
  repository-navigation backlog. Apply the suite without requiring the
  prepared request to repeat it.
- `task_specific` mode uses the supplied task verbatim.
- `system_explanation` mode uses the supplied question verbatim and applies the
  explanation constraints below.
- Infer the run name locally: use `General repository navigation` for general
  mode; otherwise use the first sentence or thought, trimmed to at most 72
  characters.
- Always set `runConditions.auditMode` to the supplied mode and
  `runConditions.verificationPolicy` to `repository_appropriate`. Resolve the
  current protocol, rubric, tool policy, and execution policy from this checkout
  rather than asking the prepared request to repeat them.
- The supplied service URL and expected journal are a strict pair. Apply the
  health check and mismatch behavior in Fresh-session preflight.
- Participant identities, reasoning efforts, and phase token budgets are
  explicit runtime inputs and must be copied into the run exactly.

The sentence `Create one new run` in a prepared request authorizes that single
audit. Preparing or copying the request did not create a run.

## Workflow

1. Resolve the target's immutable repository identity and commit without changing
   it. Create a run in the journal reported by the already-running Waymark
   service, with a concise, human-readable name, the verbatim probe,
   candidate and orchestrator identities, declared tool policy, fresh-process
   execution policy, phase token budgets, run conditions, and protocol/rubric
   versions. Record `auditMode` in `runConditions` as `general`,
   `task_specific`, or `system_explanation`. The name states the probe's
   intention in at most 72 characters; it does not copy the full prompt.
2. Treat the target repository as read-only. Do not edit, install dependencies,
   format files, generate artifacts, or run commands that write into it. Use only
   safe read-only probes. A future implementation probe requires an explicitly
   disposable worktree outside the target.
3. Run `node bin/waymark.mjs --db <journal> investigation run --run <run-id>`.
   This is the only supported launcher. It dispatches candidate and independent
   roles in parallel, imports only the candidate's cited, dimension-tagged
   navigation findings with explicit friction statements as claims, then
   dispatches the orchestrator. Feature-surface understanding is
   persisted separately as validator-only `probe.result` evidence and must
   never support a recommendation. All three roles run as fresh, non-resumed
   provider processes with assignment-only context and a read-only sandbox. The
   orchestrator stores challenges, deterministic verification requests, and
   structured recommendation drafts. In `general` mode it also requires both
   investigations to assess every Practice Guide principle and requires the
   orchestrator to draft exactly one profile result for IDs `01` through `07`.
   A candidate failure remains fatal because there is no claim source. If the
   candidate completes but independent research fails or exceeds policy, retain
   and import the candidate evidence, mark the run calibration-ineligible, and
   continue diagnostic orchestration with independent coverage explicitly
   unavailable. Never imply independent agreement in that report.
   Malformed semantic links inside an otherwise usable structured result are
   not an all-or-nothing failure. Retain valid cited navigation findings,
   reject only invalid findings or references, downgrade an unsupported
   general-practice assessment to `not_assessed`, journal each rejected item,
   and continue as calibration-ineligible. Never repair a bad reference by
   guessing or linking a finding the role did not select. Candidate failure is
   fatal only when no usable cited candidate finding remains.
   Never replace this command with subagents
   forked from the controlling conversation or an ad hoc provider command.
   Before paid work, prove the installed Codex JavaScript entry point with a
   no-model preflight; use `--codex-entry <path>` or `WAYMARK_CODEX_ENTRY` when
   automatic Windows discovery is unavailable. In Codex desktop managed
   sandboxes, launch this provider-spawning command with
   `sandbox_permissions: require_escalated` on the first attempt because its
   child processes require outbound access to the provider API. Request a
   reusable approval prefix scoped to `node bin/waymark.mjs ... investigation
   run`; do not first consume the authorized run with a restricted-sandbox
   attempt. This escalation applies only to the outer provider launcher:
   preserve the audited roles' read-only target sandbox, disabled shell
   network, and fixed tool policy. Keep local health, journal, verification,
   finalization, and scoring commands un-escalated unless they independently
   require broader access.
4. Confirm that the runner persisted monotonic stage progress, live tool events,
   completion or failure events, and each role's host-measured tokens in the
   correct phase. Missing telemetry remains unavailable. A blocked command still
   consumes navigation budget. The runner counts command starts, interrupts on
   shell command N+1, records a policy violation, and makes the run
   calibration-ineligible. When the provider supports same-session resume, the
   interruption must still reserve one no-tools reporting turn so completed
   research is not discarded. Count only the audited role processes:
   development, debugging, UI checks, and operator conversation never enter the
   run.
5. Review the imported navigation claims and the orchestrator's challenges and
   verification requests. Separately use each validator-only probe result to
   judge whether the agent found and understood enough of the requested probe
   surface for the navigation evidence to be adequate. In
   `system_explanation` mode, use the concise supported answer only as the
   adequacy gate; measure the tokens and navigation work required to find it.
   Do not reward prose depth or require hypothetical change-surface recall.
   Behavior mechanics are validation evidence, not report content. The independent researcher and
   orchestrator may expose missing consumers, hidden dependencies, unsupported
   certainty, and conflicting instructions, but agreement is not proof.
6. Verify every critical claim deterministically where possible. Discover the
   repository's own validation workflow and choose the least-privileged method
   that proves each claim. Static inspection is sufficient for fully supported
   navigation-only claims. Run an executable probe only when it is material and
   safe; isolate commands that may write outside the target. Never
   automatically install dependencies, restore packages, start services, or
   enable network access. If required setup or permission is unavailable,
   record the probe as failed or unavailable with the exact limitation and
   continue the report. Record `verified`, `contradicted`, or `unverified`;
   never silently drop unresolved claims. Include `citationStatus` and
   `independentAssessment` in verification evidence as described in the
   protocol.
7. Run `node bin/waymark.mjs --db <journal> report finalize --run <run-id>`.
   This deterministically rejects recommendation drafts that cite missing,
   contradicted, or non-deterministically verified claims. A finalized
   recommendation must show the observed problem, exact evidence, a named
   repository-navigation change, its token mechanism, limitations, and a
   repeatable before/after validation check. The selected question or task
   remains only a probe; never convert the recommendation into feature
   implementation advice. For `general` mode, finalization also rejects a
   practice profile that omits or duplicates a Practice Guide ID, treats an
   unverified claim as evidence, or leaves a mixed or weak practice without a
   linked improvement. Other audit modes do not create a practice profile.
8. Create the observation-count JSON from the stored trace and verified answer
   key. Read the stored report, then optionally run
   `node .agents/skills/waymark-audit/scripts/build-score-input.mjs` to assemble
   a preview of the canonical scorer input. Inspect it for traceability.
9. Call `score calculate --finish` with the observation-count JSON. An
   adequacy failure is a scored evidence limitation, not by itself a protocol
   failure: preserve the scorer's caps and token-efficiency eligibility result
   instead of preemptively failing the run. The CLI rebuilds canonical scorer
   input from the persisted report, stores its hash, and completes the run
   atomically. Only the Waymark deterministic scorer may emit the authoritative
   score. Read the stored report and summarize evidence, caps, confidence gap,
   reliability, the declared candidate target, the observed candidate-process
   token total, and their exact efficiency formula.
10. If the completed report's recommendations require a corrected evidence
    review, append a post-run evidence review with `report recommend`. Every action must cite
    existing deterministically verified claim IDs and identify exact
    repository-navigation changes, validation checks, and known limits. Do not
    turn the probe into a feature implementation plan. This addendum refines
    the report narrative only; it never changes scores, reliability, or token
    records.

When live usage reaches the reporting reserve, stop the full provider process
tree and resume the same session once with a reporting-only directive. The
reserve trigger must account for both cumulative usage and the current context
that a resumed turn must replay; the fixed 20% reserve is only a minimum. If a
telemetry update jumps past the hard limit, or the provider exits over budget
before returning structured output, make the same rescue attempt instead of
discarding the session. The rescue may not call tools, has a five-minute safety
deadline, and remains subject to the declared hard token limit. Persist and
continue with a valid partial result; if the rescue fails, record that failure
explicitly.

If a provider reports a hard-token-limit overrun only after returning a complete
structured result, append `budget.exceeded`, retain that result, continue the
workflow, and record that the result exceeded its declared resource reference.
The overrun is scored navigability evidence, not a reason to discard
already-paid work or invalidate an otherwise protocol-compliant benchmark.
Likewise, an independent-role failure must not discard a completed candidate
result: continue as a diagnostic-only run and expose the missing independent
coverage. If the candidate fails or orchestration otherwise cannot continue,
append a failure event and finish the run as `failed` or `cancelled`; do not
manufacture missing evidence. Keep failed attempts as separate runs. Never
reuse their context or silently raise a hard limit after observing the result.

## Fresh-session preflight

Before the next audit:

1. Confirm the target path, mode (`general`, `task_specific`, or
   `system_explanation`), immutable commit, and clean read-only status.
2. Reuse the observer and service already started by the user. Call its
   `/health` endpoint and treat the returned `databasePath` as the authoritative
   journal. Pass that exact path with `--db` to every CLI command and create a
   new run inside it; never create a new database for a new audit. Do not run
   `npm run dev`, `npm run dev:service`, change ports, or restart user-owned
   processes. If the service is unavailable or its journal differs from the
   prepared request, stop and report the mismatch. Confirm that the UI shows
   the intended run ID before launching roles, then verify its SSE endpoint.
3. Confirm the provider launcher, JSONL usage event, output schema, read-only
   sandbox, and allowed read-command shapes with a cheap preflight. A no-model
   preflight does not prove provider API connectivity. On a managed Codex host,
   treat the provider-spawning investigation launcher as requiring outer
   network escalation by default.
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
