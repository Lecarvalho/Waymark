# Read-only local service

The Waymark service is a read-only projection boundary over the append-only
audit journal. It can read persisted reports, normalize them for the observer
interface, and stream journal-change notifications. It cannot create or update
runs, invoke models, write score events, or mutate SQLite.

## Data flow

```text
SQLite audit journal
  -> AuditStore report/read models
  -> pure snapshot projectors
  -> normalized run snapshot
  -> read-only HTTP and SSE
  -> observer interface
```

The journal and the deterministic scorer remain authoritative. Snapshot code is
presentation projection only: it may verify and reproduce a persisted
authoritative score event, but it must not invent a score or write one back.

## Module ownership

| Module | Owns |
| --- | --- |
| `waymark-server.mjs` | Compatibility exports, dependency composition, direct-execution startup, and signal shutdown. |
| `read-only-http-service.mjs` | `GET`/`OPTIONS` routes, CORS and JSON policy, parameter decoding, provider-capability reads, and error-to-status translation. |
| `journal-event-stream.mjs` | SSE registration, `ready`/`changed`/`heartbeat` events, database/WAL/SHM polling, timer cleanup, and client cleanup. |
| `run-snapshot.mjs` | Shared snapshot context, run provenance, participants, final wire-object assembly, and delegation to the projectors below. |
| `general-audit-snapshot.mjs` | General-audit status, progress, phase, latest-event copy, provider session, report completion, and compatible/excluded history. |
| `benchmark-run-snapshot.mjs` | Task-specific and system-explanation authoritative-score verification, calibration, progress, phase, score breakdown, and benchmark metrics. |
| `token-usage-snapshot.mjs` | Normalized totals, phase usage, candidate budget, context telemetry, token-source labels, resource overruns, and unavailable monetary cost. |
| `report-content-snapshot.mjs` | Evidence display, evidence-linked and legacy recommendations, Practice Guide findings/profile, and UUID-safe user-facing report text. |

General response fields therefore start in
`general-audit-snapshot.mjs`; benchmark scores and calibration start in
`benchmark-run-snapshot.mjs`; token fields start in
`token-usage-snapshot.mjs`; recommendations and Practice Guide fields start in
`report-content-snapshot.mjs`. Route and SSE behavior never owns report
formulas.

All projector functions accept persisted report/read-model values as
arguments. They do not open SQLite, inspect environment variables, start
servers, or manage timers.

## Public compatibility

Existing callers may continue importing these from `waymark-server.mjs`:

- `startWaymarkServer`
- `toRunSnapshot`
- `buildGeneralAuditHistory`

New projection code should import the owning module directly. The executable
entry depends inward on transport and projection modules; projector modules
must not import the executable entry.

## Test ownership

- `tests/run-snapshot.test.mjs` locks shared and normalized snapshot sections.
- `tests/general-audit-service-projection.test.mjs` locks general status,
  progress, and history compatibility.
- `tests/read-only-service.test.mjs` locks HTTP policy and status translation.
- `tests/service-integration.test.mjs` retains the cross-boundary regression suite for
  complete, partial, failed, restart, SSE, and read-only SQLite scenarios.

Any response-field change belongs with a focused projector test and, when it
crosses persistence or transport, an integration assertion in
`tests/service-integration.test.mjs`.
