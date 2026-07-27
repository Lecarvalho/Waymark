# Waymark Product Context

## Purpose

Waymark measures how efficiently and reliably coding agents can navigate a
repository. It makes the investigation observable, preserves cited evidence,
and tracks navigability over time.

Waymark has two audit contracts:

- A `general` audit is a broad, evidence-led repository assessment performed by
  one most-capable auditor. It does not launch candidate, independent, or
  orchestrator roles and is not a benchmark task suite.
- `task_specific` and `system_explanation` audits are reproducible navigation
  probes. They retain candidate research, independent research, orchestration,
  deterministic verification, versioned scoring, and hard-budget behavior.

A task-specific probe is a realistic engineering task. A system-explanation
probe is a short question about existing behavior and primarily measures the
tokens and navigation work needed to reach an adequate supported answer. The
probe is never a request for implementation advice.

A general audit researches production code, tests, dependency paths and
consumers, configuration, workflows, generated or external boundaries,
documentation, and repository instructions. It reports strengths as well as
navigation friction, with coverage limitations and unknowns. It does not claim
literal exhaustive coverage and does not become a review of general code
quality, security, correctness, accessibility, or maintainability.

## Platform

Waymark is a local-first web application paired with coding-agent tools such as
Codex and Claude Code. A preparation-only modal can assemble a complete audit
request for the user to copy into that paired agent session. The agent session
receives and executes the request; Waymark remains the observer and durable
report surface.

## Users

- Engineering teams evaluating whether a repository is ready for agentic work
- Technical leaders comparing navigability across repositories and commits
- Developers improving repository structure, documentation, and boundaries
- Tooling teams comparing model performance under reproducible conditions

## Core Commitments

- Report measured AI coding navigability, not broad software quality.
- Record the starting commit as provenance without freezing the target.
  Repository evolution during an audit is valid; report the state actually
  observed rather than failing on HEAD or worktree drift.
- Keep the target repository read-only during discovery by default. A general
  audit may instead use explicitly user-authorized unrestricted execution when
  that permission mode is recorded with the run; never silently widen access.
- In benchmark modes, separate candidate performance, candidate confidence,
  and report reliability, and prefer executable or deterministic verification
  over model agreement.
- Preserve model identity, task, commit, token usage, evidence, and run
  conditions so comparisons remain honest.
- Keep repository navigability, report completeness or reliability, and audit
  economy visibly separate.
- Give recommendations with expected discovery and consumption impact.
- Tie recommendations to repository structure, naming, documentation,
  boundaries, and verification discoverability observed during the run.
- In general mode, require cited support for both favorable and unfavorable
  judgments. Absence of evidence is `not_assessed`, never a favorable result.

## General Audit Contract

The single general auditor assesses the seven Practice Guide principles:
organize around behavior, make dependency direction explicit, name files for
the concept they own, provide one canonical workflow, put instructions close to
the code, make tests mirror behavior, and separate generated and external code.

The auditor also assesses the six weighted navigability dimensions:

- `discoveryEfficiency`: 20%
- `ownershipClarity`: 17%
- `dependencyClarity`: 17%
- `changeSurfaceRecall`: 20%
- `verificationDiscoverability`: 16%
- `instructionQuality`: 10%

These dimension judgments are auditor inferences supported by cited evidence.
The benchmark observation workload and authoritative deterministic scorer do
not score a general audit. A complete general report may show an
`auditor_assessed` weighted result only when all six dimensions have adequate
evidence. An incomplete report shows the exact assessed weight and available
findings without normalizing the assessed subset or treating missing dimensions
as zero.

Conclusions about code structure, naming, ownership, dependency direction,
behavior organization, or test mirroring require citations to actual source or
tests. Documentation can corroborate those conclusions but cannot be their only
evidence. When the repository contains representative runtime or behavior
paths, the auditor attempts at least two paths, connecting each known entry
point, owner, dependencies, consumers, and tests and marking unknown nodes
explicitly.

General findings are appended at semantic checkpoints while research is active.
Later evidence may confirm, reframe, contradict, or retract a finding, but its
earlier revisions remain in the append-only history. This allows a late
discovery to remain evidence that something exists but was difficult to find.

General terminal outcomes are:

- `completed`: required coverage and synthesis are complete.
- `partial`: usable cited evidence exists, but required coverage or synthesis
  is incomplete.
- `failed`: no usable report evidence was recovered.
- `cancelled`: the user stopped the audit; any durable cited evidence remains
  visible.

General audits have no Waymark hard token limit and no token-efficiency score.
Measured token usage remains visible. Evidence coverage, rather than a token
ceiling, drives completion. Optional soft usage notices, user cancellation, and
provider-context continuation are operational safeguards, not benchmark
validity rules.

## Interface Posture

The application is an evidence console, not a chat client. It should feel calm,
forensic, and operational. Dense information is acceptable when the hierarchy is
clear and the text remains readable. Live state must be explicit without
decorative urgency.

The interface may prepare an audit request without starting one. The user
selects the repository, audit mode, task or explanation question, and available
provider/model/reasoning combinations. General audits also select either the
default read-only sandbox or explicit full access without approval prompts. The
user then explicitly copies a compact handoff containing those runtime inputs.
Fixed workflow, safety, and mode-specific
assessment or scoring policy come from the versioned repository-local audit
skill. Model and
reasoning choices come from runtime adapter capabilities rather than a
hardcoded catalog. Preparing or copying a request does not create a run, invoke
a model, write to SQLite, or imply that an audit has started.

## Anti-goals

- Starting an audit, invoking a model, or writing an audit record from the
  request-preparation modal
- Turning the preparation modal into a chat client
- Hardcoding provider model or reasoning-effort catalogs in presentation code
- Scoring security, accessibility, correctness, or maintainability
- Treating model agreement as proof
- Presenting mock data as a real measurement
- Hiding weak verification behind a confident final score
- Presenting documentation-only support as proof of code structure
- Renormalizing an incomplete general assessment into a complete score
- Recommending how to implement the feature used as the navigation probe
