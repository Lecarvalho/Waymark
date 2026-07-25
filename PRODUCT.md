# Waymark Product Context

## Purpose

Waymark measures how efficiently and reliably coding agents can navigate a
repository while following a reproducible navigation probe. It makes the
investigation observable, challenges model claims, preserves the evidence, and
tracks navigability over time.

The probe can be a versioned general suite, a realistic engineering task, or a
question asking how existing system behavior works. It is not a request for
implementation advice. Waymark reports how hard it was to find the information
needed for that probe and what repository-level changes would make the next
agent's navigation more direct. System-explanation probes use a short question
and primarily measure the tokens and navigation work needed to reach an
adequate supported answer; prose depth and hypothetical change-surface recall
are not objectives.

A general repository audit is the broad mode. Its versioned suite samples
representative repository surfaces and returns a verified result for every
Practice Guide principle: behavior organization, dependency direction, concept
naming, canonical workflows, proximal instructions, test discoverability, and
generated or external code boundaries. It states sampling limits and unknowns;
it does not claim exhaustive coverage or become a general code-quality review.
Task-specific and system-explanation audits do not add this repository-wide
profile.

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
- Keep the target repository read-only during discovery.
- Separate candidate performance, candidate confidence, and report reliability.
- Prefer executable or deterministic verification over model agreement.
- Preserve model identity, task, commit, token usage, evidence, and run
  conditions so comparisons remain honest.
- Keep repository navigability, audit reliability, and audit economy visibly
  separate; a reliable or navigable result must not hide an over-budget run.
- Give recommendations with expected discovery and consumption impact.
- Tie recommendations to repository structure, naming, documentation,
  boundaries, and verification discoverability observed during the run.
- In general mode, show all seven Practice Guide outcomes and link every mixed
  or weak outcome to a verified repository-specific improvement.

## Interface Posture

The application is an evidence console, not a chat client. It should feel calm,
forensic, and operational. Dense information is acceptable when the hierarchy is
clear and the text remains readable. Live state must be explicit without
decorative urgency.

The interface may prepare an audit request without starting one. The user
selects the repository, audit mode, task or explanation question, and available
provider/model/reasoning combinations, then explicitly copies a compact handoff
containing those runtime inputs. Fixed workflow, safety, and scoring
policy come from the versioned repository-local audit skill. Model and
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
- Recommending how to implement the feature used as the navigation probe
