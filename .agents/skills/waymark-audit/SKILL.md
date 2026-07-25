---
name: waymark-audit
description: Run an evidence-backed Waymark audit of a local repository. General mode uses one auditor for a broad cited assessment; task-specific and system-explanation modes use the measured candidate benchmark workflow.
---

# Waymark audit

Read [references/protocol.md](references/protocol.md) before starting. Run commands
from the Waymark repository and use `node bin/waymark.mjs`; add `--db <path>` when
the default journal is not appropriate.

## Prepared request contract

Requests copied from the Waymark observer intentionally contain only runtime
inputs. Treat this skill and its protocol as authoritative for fixed workflow,
safety, persistence, and mode-specific assessment or scoring behavior; do not
require the copied request to repeat those rules.

Resolve omitted fixed metadata as follows:

- `general` mode is a broad repository assessment by exactly one `auditor`.
  It does not use a versioned benchmark task suite and must not launch
  candidate, independent, or orchestrator roles. Its token policy is
  `unbounded_by_waymark`: measure usage, but do not apply a Waymark hard limit
  or token-efficiency score.
- `task_specific` mode uses the supplied task verbatim and follows the
  benchmark workflow below.
- `system_explanation` mode uses the supplied question verbatim, applies the
  explanation constraints below, and follows the benchmark workflow.
- Infer the run name locally: use `General repository navigation` for general
  mode; otherwise use the first sentence or thought, trimmed to at most 72
  characters.
- Always set `runConditions.auditMode` to the supplied mode and
  `runConditions.verificationPolicy` to `repository_appropriate`. Resolve the
  current protocol, rubric, tool policy, and execution policy from this checkout
  rather than asking the prepared request to repeat them.
- The supplied service URL and expected journal are a strict pair. Apply the
  health check and mismatch behavior in Fresh-session preflight.
- For general mode, the auditor identity and reasoning effort are explicit
  runtime inputs. Optional soft usage notices are operational settings, not
  stopping thresholds.
- For benchmark modes, participant identities, reasoning efforts, and phase
  token budgets are explicit runtime inputs and must be copied into the run
  exactly.

The sentence `Create one new run` in a prepared request authorizes that single
audit. Preparing or copying the request did not create a run.

## Mode routing

Route by `auditMode` before creating or launching a run:

- `general` follows the single-auditor workflow below.
- `task_specific` and `system_explanation` follow the benchmark workflow.

Never substitute the benchmark pipeline for a general audit. If the installed
CLI does not yet expose the single-auditor general commands required by the
protocol, stop before paid work and report that the requested contract is not
available in this checkout.

## General workflow

1. Resolve the target's immutable repository identity and commit without
   changing it. Create one general run with one auditor, read-only target
   policy, `general_research` token measurement, and
   `unbounded_by_waymark` token policy. Do not create candidate, independent,
   orchestrator, or benchmark-verifier participants.
2. Research production code, tests, dependency paths and consumers,
   configuration, workflows, generated or external boundaries, documentation,
   and repository instructions. This is high-recall sampling, not a claim of
   literal exhaustive coverage.
3. Attempt at least two representative behavior or runtime paths when the
   repository contains them. For each, connect the known entry point, owner,
   dependencies, consumers, and tests; mark unknown or uninspected nodes
   explicitly.
4. Append semantic checkpoints while research is active. Record strengths,
   friction, inspected surfaces, behavior paths, dimension progress, and
   recommendations. Revise findings without deleting earlier revisions. A late
   discovery must preserve the original navigation cost and explain why the
   conclusion changed.
5. Require positive evidence for strong assessments and concrete negative
   evidence for mixed or weak assessments. A conclusion about code structure,
   naming, ownership, dependency direction, behavior organization, or test
   mirroring must cite actual source or tests. Documentation may corroborate
   but cannot be the only evidence. Use `not_assessed` when evidence is
   inadequate.
6. Assess the seven Practice Guide principles: organize around behavior, make
   dependency direction explicit, name files for the concept they own, provide
   one canonical workflow, put instructions close to the code, make tests
   mirror behavior, and separate generated and external code.
   Assess the six dimensions using their fixed weights:
   `discoveryEfficiency` 20%, `ownershipClarity` 17%,
   `dependencyClarity` 17%, `changeSurfaceRecall` 20%,
   `verificationDiscoverability` 16%, and `instructionQuality` 10%.
7. Treat dimension judgments as auditor inferences from cited evidence. Do not
   run the benchmark observation-count workload or authoritative deterministic
   scorer. Emit an `auditor_assessed` weighted result only when all dimensions
   have adequate evidence. Otherwise report exact assessed weight and findings
   without renormalizing missing dimensions or treating them as zero.
8. Finish as `completed` only when required coverage and synthesis are
   complete. Use `partial` when cited evidence is usable but required coverage
   or synthesis is incomplete, `failed` when no usable report evidence was
   recovered, and `cancelled` when the user stops the run. A partial or
   cancelled run retains every acknowledged finding.

General completion is driven by evidence coverage, not token consumption.
Measure and display usage. Soft usage notices, no-progress protection, user
cancellation, and provider-context continuation are operational safeguards.
Continuation resumes from the projected finding ledger and open coverage, not
from the controlling conversation. These safeguards do not determine benchmark
validity.

## Benchmark workflow

1. Resolve the target's immutable repository identity and commit without changing
   it. Create a run in the journal reported by the already-running Waymark
   service, with a concise, human-readable name, the verbatim probe,
   candidate and orchestrator identities, declared tool policy, fresh-process
   execution policy, phase token budgets, run conditions, and protocol/rubric
   versions. Record `auditMode` in `runConditions` as `task_specific` or
   `system_explanation`. The name states the probe's intention in at most 72
   characters; it does not copy the full prompt.
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
   structured recommendation drafts. A candidate failure remains fatal because
   there is no claim source. If the candidate completes but independent
   research fails or exceeds policy, retain and import the candidate evidence,
   mark the run calibration-ineligible, and continue diagnostic orchestration
   with independent coverage explicitly unavailable. Never imply independent
   agreement in that report.
   Malformed semantic links inside an otherwise usable structured result are
   not an all-or-nothing failure. Retain valid cited navigation findings,
   reject only invalid findings or references, journal each rejected item, and
   continue as calibration-ineligible. Never repair a bad reference by guessing
   or linking a finding the role did not select. Candidate failure is fatal
   only when no usable cited candidate finding remains.
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
   implementation advice. Benchmark modes do not create a general Practice
   Guide profile.
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

1. Confirm the target path, immutable commit, and clean read-only status.
   General mode uses the repository and service checks here but not the
   benchmark launcher, role, or budget checks.
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
4. For benchmark modes, declare efficiency targets separately from calibrated
   validity ceilings. Targets express desired cost; hard ceilings must be
   chosen from a prior bounded measurement for that host/model/task class and
   stay fixed for the run. For general mode, confirm the
   `unbounded_by_waymark` policy, optional soft notices, and no-progress
   protection instead.
5. In benchmark modes, confirm the runner appends `investigation.started` for
   the candidate and independent roles and `orchestration.started` for the
   orchestrator before each launch. Stream observable tool/file/search events
   into SQLite as the JSONL arrives, then verify in the UI that active-role
   counts, phase, progress, and token source are current.
6. After completion, confirm every stored optional token dimension came from
   telemetry. Missing subfields remain unavailable, never zero.

## Authority boundary

In benchmark modes, never ask or allow the candidate to assign an overall,
dimension, reliability, or token-efficiency score. Candidate confidence is
evidence, not authority. Candidate-provided scores must not enter scorer input.
Deterministic verification outranks independent agreement, and token efficiency
is interpreted only after adequacy gates pass.

In general mode, the auditor may assess the six dimensions only from cited,
adequately covered evidence. Label the result `auditor_assessed`, not
authoritative or deterministic. Never convert missing coverage into a zero or a
complete score, and never let documentation alone support a code-structure
conclusion.
