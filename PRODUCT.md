# Waymark Product Context

## Purpose

Waymark measures how efficiently and reliably coding agents can navigate a
repository while attempting a realistic engineering task. It makes the
investigation observable, challenges model claims, preserves the evidence, and
tracks navigability over time.

## Platform

Waymark is a local-first web application paired with coding-agent tools such as
Codex and Claude Code. The agent session receives the audit request. Waymark is
the observer and durable report surface.

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

## Interface Posture

The application is an evidence console, not a chat client. It should feel calm,
forensic, and operational. Dense information is acceptable when the hierarchy is
clear and the text remains readable. Live state must be explicit without
decorative urgency.

## Anti-goals

- Starting or prompting audits from the dashboard
- Scoring security, accessibility, correctness, or maintainability
- Treating model agreement as proof
- Presenting mock data as a real measurement
- Hiding weak verification behind a confident final score
