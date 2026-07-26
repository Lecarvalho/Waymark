# Agent Navigability Refactor Tasks

## How to use this file

Complete these tasks in order. Each task should be small enough for a fresh
coding-agent session to understand, implement, verify, and review without first
reconstructing unrelated parts of the codebase.

The refactors are behavior-preserving. They improve ownership, discoverability,
and agent context efficiency; they are not permission to redesign the interface
or change service contracts.

---

## NAV-01 — Scope the general-audit investigation graphics

**Dependencies:** None.

**Status:** Complete.

### Context

`app/globals.css` is more than 7,000 lines and combines tokens, reset rules,
shared primitives, application shell styles, feature styles, responsive rules,
and a large legacy layer. An agent changing one component must inspect much of
the file to understand ownership and cascade order.

The investigation graphics are the safest first extraction:

- their React owner is
  `app/general-audit-investigation-graphics.tsx`;
- their selectors have an identifiable prefix and occupy one contiguous block
  near the end of `app/globals.css`;
- they already contain their narrow-width behavior beside the feature block;
- no other product surface should depend on their internal selectors.

This first task should establish the migration pattern future tasks can repeat.

### Goal

Move all styles owned exclusively by the general-audit investigation graphics
into a co-located CSS Module, preserving the current desktop and narrow-width
appearance and every interaction.

After this task, an agent working on investigation paths, discovery journeys,
finding evolution, recommendation priority, or dimension trends should be able
to find the relevant component and stylesheet without searching
`app/globals.css`.

### Required changes

- Create `app/general-audit-investigation-graphics.module.css`.
- Move the complete investigation-graphics feature block out of
  `app/globals.css`, including:
  - progressive-disclosure graphic tabs;
  - behavior-path maps, nodes, edges, states, citations, and legends;
  - discovery journeys and measurement summaries;
  - finding-evolution timelines;
  - recommendation impact/effort tables;
  - historical dimension trends and incompatible-run disclosure;
  - the feature's `760px` responsive rules.
- Import the CSS Module from
  `app/general-audit-investigation-graphics.tsx`.
- Replace feature-owned global class strings with CSS Module references.
- Prefer stable `data-*` state attributes over dynamically constructed global
  classes:
  - `data-state` for current, difficult-to-discover, pending, contradicted, and
    finding-revision states;
  - `data-availability` for measured, unavailable, and recorded journey steps;
  - `data-partial` for partial historical runs.
- Keep genuinely shared primitives global for now, including `panel`,
  `panel-heading`, `section-kicker`, `muted-action`, and
  `empty-report-state`. Combine those global classes with the module's root
  class where needed.
- Add `app/styles/STYLE_MAP.md` with:
  - the investigation component-to-module ownership mapping;
  - the shared global primitives it intentionally consumes;
  - its supported state attributes and breakpoint;
  - a short note that the remaining feature styles are still awaiting scoped
    extraction.
- Remove the migrated selectors from `app/globals.css`; do not leave duplicate
  fallback copies.

### Migration constraints

- Preserve the existing cascade behavior. The module should load after the
  shared global tokens and primitives it consumes.
- Preserve accessible names, tab semantics, details/summary behavior, table
  semantics, keyboard behavior, and visible text.
- Preserve semantic signal colors and non-color state indicators.
- Keep horizontal scrolling contained within the behavior map and wide tables;
  the page itself must not gain horizontal overflow.
- Keep responsive rules beside the owning feature rules in the module.
- Do not introduce `!important`, a class-name composition dependency, or a
  charting/styling library.
- Do not move shared tokens or generic primitives in this task.

### Likely files

- New `app/general-audit-investigation-graphics.module.css`
- New `app/styles/STYLE_MAP.md`
- `app/general-audit-investigation-graphics.tsx`
- `app/globals.css`

### Non-goals

- Do not redesign or restyle the investigation graphics.
- Do not split the React component into additional components yet.
- Do not migrate the general-audit summary graphics, request dialog, history,
  Practice Guide, shell, tokens, reset, or shared panel styles.
- Do not rename user-facing labels or change report/service data contracts.
- Do not remove or reorganize the existing legacy layer outside the selectors
  owned by this feature.

### Acceptance criteria

- No investigation-feature selector remains in `app/globals.css`.
- Every moved selector is scoped through the CSS Module or an explicit
  component state attribute.
- `STYLE_MAP.md` lets an unfamiliar agent locate the component, stylesheet,
  shared dependencies, states, and responsive breakpoint without scanning the
  global stylesheet.
- Desktop rendering matches the current evidence-console layout.
- At approximately `390px`, the document width does not exceed the viewport;
  the behavior map, feature tabs, and wide tables scroll only inside their
  intended containers.
- All five graphic tabs remain keyboard reachable and expose one graphic at a
  time.
- Existing complete, partial, located-late, unknown/uninspected, and
  incompatible-history states remain visually and textually distinguishable.

### Verification

- Run `npm run build`.
- Run `npm test`.
- Run `npm run lint`.
- Visually inspect all five graphic tabs at desktop width.
- Visually inspect the behavior map, recommendation table, and historical trend
  view at approximately `390px`.
- Confirm browser diagnostics contain no new errors or warnings.
- Confirm `document.body.scrollWidth` does not exceed the viewport width at the
  narrow breakpoint.

---

## NAV-02 — Decompose the read-only Waymark service

**Dependencies:** NAV-01.

**Status:** Complete.

### Context

`server/waymark-server.mjs` is approximately 1,700 lines and currently owns
several different responsibilities:

- HTTP response policy, CORS, routing, and error translation;
- server-sent event clients, journal polling, and heartbeat lifecycle;
- general-audit status, progress, provider-session, history, and snapshot
  projection;
- benchmark score, evidence, token, recommendation, Practice Guide, and
  participant projection;
- provider-capability routing;
- process startup and shutdown.

The largest hotspot is `toRunSnapshot`, which spans roughly half the file.
Agents changing one response field must reconstruct unrelated HTTP, token,
scoring, general-audit, and lifecycle behavior before they can edit safely.

The local service must remain read-only. This refactor must not move mutations
into the service, change scoring authority, or alter any response contract.

### Goal

Turn `server/waymark-server.mjs` into a small composition and executable-entry
module, with named modules for transport, event streaming, mode-specific
projection, and shared snapshot sections.

An unfamiliar agent should be able to determine where a response field is
produced and which tests cover it without reading the entire service.

### Target module map

Use these ownership boundaries unless implementation evidence supports a
similarly explicit alternative:

```text
server/
  waymark-server.mjs
  read-only-http-service.mjs
  journal-event-stream.mjs
  run-snapshot.mjs
  general-audit-snapshot.mjs
  benchmark-run-snapshot.mjs
  token-usage-snapshot.mjs
  report-content-snapshot.mjs
  README.md
```

Responsibilities:

- `waymark-server.mjs`
  - public compatibility exports;
  - dependency composition;
  - direct-execution startup and signal shutdown only.
- `read-only-http-service.mjs`
  - `GET` and `OPTIONS` routing;
  - CORS, JSON responses, route parameter decoding, and error-to-status
    translation;
  - provider-capability reads;
  - no report projection formulas.
- `journal-event-stream.mjs`
  - SSE client registration;
  - ready, changed, and heartbeat events;
  - database/WAL/SHM signature polling and cleanup.
- `run-snapshot.mjs`
  - top-level `toRunSnapshot` composition;
  - shared run provenance, participants, phase, progress, and final response
    assembly;
  - delegation to mode-specific and section-specific projectors.
- `general-audit-snapshot.mjs`
  - general audit status, phase, coverage progress, latest-event text, provider
    session, compatible history, and general snapshot projection.
- `benchmark-run-snapshot.mjs`
  - task-specific and system-explanation evidence, calibration, score, and
    benchmark phase projection.
- `token-usage-snapshot.mjs`
  - normalized totals, per-phase usage, candidate budget, context telemetry,
    source labels, and unavailable monetary-cost projection.
- `report-content-snapshot.mjs`
  - evidence-linked recommendations, Practice Guide profile, practice
    findings, and safe user-facing report text.

Do not create generic modules named `utils`, `helpers`, `common`, or `manager`.

### Required changes

1. Lock the current public contract before moving code:
   - retain representative general, benchmark, partial, failed, and empty
     fixtures;
   - add focused deep-equality or golden assertions for the normalized snapshot
     sections most likely to drift;
   - keep deterministic values such as dates and identifiers stable in
     fixtures.
2. Extract pure projection code before extracting transport:
   - projection modules accept persisted report/read-model data as arguments;
   - they do not open SQLite, read environment variables, create HTTP servers,
     or manage timers;
   - scoring verification continues to use the persisted authoritative score
     event and current deterministic scorer contract.
3. Decompose `toRunSnapshot` into named section projectors rather than moving
   one 800-line function unchanged:
   - build shared context once;
   - project general and benchmark mode sections independently;
   - project token usage and report content through their owning modules;
   - assemble the final wire response in `run-snapshot.mjs`.
4. Extract the HTTP and SSE lifecycle:
   - keep every endpoint and status code unchanged;
   - preserve `GET`/`OPTIONS` only and the `read_only_service` response for
     mutations;
   - preserve `/health`, `/api/provider-capabilities`, `/api/events`,
     `/api/runs`, `/api/runs/summaries`, `/api/runs/latest`,
     `/api/runs/:id/events`, and `/api/runs/:id`;
   - preserve journal-change and heartbeat cleanup when the service closes.
5. Keep compatibility exports from `server/waymark-server.mjs` for
   `startWaymarkServer`, `toRunSnapshot`, and `buildGeneralAuditHistory` so
   existing imports and external callers do not break.
6. Add `server/README.md` documenting:
   - the read-only service boundary;
   - the report-to-snapshot-to-HTTP data flow;
   - module ownership;
   - which module owns general versus benchmark fields;
   - the rule that presentation projections cannot become authoritative
     scoring or mutate the journal.
7. Split `tests/service.test.mjs` by the same ownership boundaries while
   retaining all existing scenarios. Prefer:
   - `tests/run-snapshot.test.mjs`;
   - `tests/general-audit-service-projection.test.mjs`;
   - `tests/read-only-service.test.mjs`;
   - shared, explicitly named fixture builders under `tests/fixtures/`.

### Migration constraints

- Preserve exact JSON response shapes, labels, nullability, ordering, status
  codes, and endpoint behavior unless an existing test proves the old behavior
  invalid.
- Preserve benchmark behavior for `task_specific` and `system_explanation`.
- Preserve the single-auditor general mode and compatible-history rules.
- Preserve separation between general auditor assessment and authoritative
  deterministic benchmark scoring.
- Keep SQLite access and provider-capability discovery at the service boundary;
  pure projection modules receive their inputs.
- Do not add a framework, router dependency, dependency-injection container, or
  runtime schema library.
- Avoid circular imports. The executable entry may depend inward on transport
  and projection modules; projection modules must not import the executable
  entry.
- Keep named modules cohesive. Do not replace one large file with many files
  that each contain only one trivial function.
- Keep the target response stable throughout the refactor. Move and verify one
  boundary at a time.

### Likely files

- `server/waymark-server.mjs`
- New focused modules under `server/`
- New `server/README.md`
- `tests/service.test.mjs`
- New focused service/projection tests under `tests/`
- New service-report fixtures under `tests/fixtures/`

### Non-goals

- Do not change the REST or SSE API.
- Do not add service mutations or model invocation.
- Do not change persistence schemas or generate a migration.
- Do not redesign scoring, token accounting, calibration, recommendations, or
  general-audit completion.
- Do not change the React interface.
- Do not convert the service to TypeScript in this task.
- Do not optimize database query counts unless required to preserve the
  existing contract during extraction.

### Acceptance criteria

- `server/waymark-server.mjs` is a clear composition/entry module and is no
  longer the owner of projection formulas or route implementations.
- No extracted module exceeds roughly 500 lines without a documented reason in
  `server/README.md`.
- An agent can locate the owner of a general-history field, benchmark score,
  token metric, recommendation, endpoint, or SSE event from `server/README.md`
  without searching every server module.
- Projection modules are deterministic and testable without opening a server
  or SQLite database.
- Existing service imports continue to work through compatibility re-exports.
- All existing general, benchmark, partial, failed, restart, SSE, and read-only
  service tests retain their assertions.
- Snapshot fixtures before and after the refactor are deeply equal.
- The local service starts, reports the same health metadata, serves the same
  latest/summaries payloads, emits SSE updates, and closes without leaked
  timers or database handles.

### Verification

- Run `npm run build`.
- Run `npm test`.
- Run `npm run lint`.
- Run focused snapshot, general-projection, and read-only HTTP tests while
  extracting each boundary.
- Start the service against a temporary audit journal and verify:
  - `/health`;
  - `/api/runs/latest`;
  - `/api/runs/summaries`;
  - `/api/provider-capabilities`;
  - the initial SSE `ready` event and one journal-driven `changed` event;
  - a non-GET request returns `405` with `read_only_service`.
- Confirm closing the service releases the temporary SQLite database and its
  WAL/SHM files.

---

## NAV-03 — Replace the global stylesheet with explicit style ownership

**Dependencies:** NAV-01.

**Status:** Not started.

### Context

After NAV-01, `app/globals.css` is still approximately 6,300 lines. The problem
is no longer only its size. It contains two overlapping styling systems:

- newer unlayered rules and feature overrides in the first portion of the
  file;
- a roughly 3,700-line `@layer legacy` block containing the reset, shell,
  benchmark report, history, Practice Guide, audit-preparation dialog, and
  responsive rules.

Core selectors such as `:root`, `sidebar`, `panel`, `page-content`, and
`audit-hero` are defined in multiple places. An agent must therefore read both
the owning React markup and a large amount of historical cascade context to
determine the effective style for one component.

Moving the same rules into arbitrarily named global files would reduce the size
of `globals.css` without reducing that reasoning cost. This task must establish
component ownership, remove historical duplication, and make the small
remaining global surface enforceable.

The React ownership boundary also needs clarification. `app/page.tsx` is more
than 2,000 lines and currently owns the benchmark report, history, Practice
Guide, application shell, and empty states. Styles cannot be made genuinely
local while those unrelated surfaces share one presentation owner.

### Goal

Turn `app/globals.css` into a small import manifest for documented global
foundations. Move product-surface styles into CSS Modules colocated with focused
React owners, and remove the legacy cascade after its effective behavior has
been preserved.

An agent changing the audit-preparation dialog, general audit, benchmark
report, history, Practice Guide, or shell should need to inspect only:

1. the owning component;
2. its CSS Module;
3. the short style ownership map;
4. a shared primitive file only when the component intentionally consumes a
   documented global primitive.

Token efficiency comes from this bounded ownership path, not from minimizing
the aggregate number of CSS files.

### Target ownership map

Use these boundaries unless implementation evidence supports a similarly
explicit alternative:

```text
app/
  globals.css
  styles/
    tokens.css
    base.css
    primitives.css
    STYLE_MAP.md
  shell.tsx
  shell.module.css
  benchmark-audit-view.tsx
  benchmark-audit-view.module.css
  history-view.tsx
  history-view.module.css
  practice-guide-view.tsx
  practice-guide-view.module.css
  general-audit-view.tsx
  general-audit-view.module.css
  general-audit-graphics.tsx
  general-audit-graphics.module.css
  general-audit-investigation-graphics.tsx
  general-audit-investigation-graphics.module.css
  prepare-audit-dialog.tsx
  prepare-audit-dialog.module.css
```

Responsibilities:

- `globals.css`
  - ordered imports only, plus a short ownership comment if useful;
  - no product-feature selectors.
- `styles/tokens.css`
  - the single canonical `:root` declaration for colors, typography, spacing,
    and other shared custom properties.
- `styles/base.css`
  - box sizing, document/body defaults, native control inheritance, and global
    focus-visible behavior.
- `styles/primitives.css`
  - the small allowlisted set of genuinely shared global classes;
  - each primitive must have at least three independent component consumers or
    a documented accessibility/layout reason to remain global.
- component CSS Modules
  - all feature layout, states, variants, tables, dialogs, and responsive rules
    owned by that component.
- focused React view components
  - presentation ownership for the shell, benchmark audit, history, and
    Practice Guide currently embedded in `app/page.tsx`;
  - receive data and callbacks from the existing page coordinator without
    taking over service reads or product logic.

Prefer smaller named subcomponents and modules when one of these owners would
otherwise remain substantially above roughly 500–600 stylesheet lines. Do not
create generic style files named `dashboard`, `common`, `misc`, `overrides`, or
`legacy`.

### Required changes

1. Lock the current rendered behavior before changing cascade ownership:
   - retain the existing rendered HTML and interaction tests;
   - identify representative complete, active, partial, failed, empty, and
     unavailable-data states;
   - record desktop and approximately `390px` visual references for the
     benchmark report, general audit, history, Practice Guide, request dialog,
     and shell;
   - identify current horizontal-scroll owners and document-width behavior.
2. Add a temporary selector ownership inventory:
   - map feature selector prefixes and unprefixed selectors to their React
     consumers;
   - identify selectors with no consumer, selectors used by multiple owners,
     dynamically constructed state classes, and selectors repeated across the
     unlayered and legacy sections;
   - treat dynamic selectors as used only when their construction is explicit
     in source or an ownership note.
3. Establish the global foundation:
   - create `tokens.css`, `base.css`, and `primitives.css`;
   - collapse duplicate `:root` declarations into one canonical token set;
   - move only reset, document, native-control, focus, and documented shared
     primitive rules into these files;
   - make `globals.css` an ordered import manifest.
4. Extract feature styles by React owner, not by their current position in the
   stylesheet:
   - move the complete audit-preparation dialog surface;
   - move the remaining general-audit view and summary-graphics surfaces;
   - extract benchmark audit, history, Practice Guide, and shell presentation
     owners from `app/page.tsx`, then colocate their styles;
   - keep each feature's responsive and reduced-motion behavior in the owning
     module;
   - keep the completed NAV-01 investigation module scoped and update only its
     documented shared imports if the primitive locations change.
5. Preserve and then remove the historical cascade deliberately:
   - while a feature still depends on legacy precedence, retain equivalent
     `@layer legacy` placement inside its module;
   - move its unlayered overrides with the same owner;
   - after visual and computed-style equivalence is established, collapse
     duplicate declarations into one canonical scoped rule;
   - remove both the legacy and override copies from `globals.css`;
   - delete the `@layer legacy` declaration after its final consumer is
     migrated.
6. Replace global state-class construction with semantic attributes:
   - use `aria-selected`, `aria-expanded`, `open`, `disabled`, and other native
     attributes when they already express the state;
   - use stable `data-state`, `data-status`, `data-availability`, or similarly
     specific attributes for product states without a native equivalent;
   - do not retain generic global `active`, `status-*`, `priority-*`, or `is-*`
     classes solely for styling.
7. Extend `app/styles/STYLE_MAP.md`:
   - map every component owner to its module;
   - list the shared global files and every allowed global class;
   - document responsive breakpoints and state attributes per owner;
   - document any intentional cross-owner dependency and why it is not a
     primitive or component prop.
8. Add an ownership regression test, preferably
   `tests/style-ownership.test.mjs`:
   - fail when `globals.css` gains product selectors or non-import rules;
   - fail when shared CSS contains a class outside the documented allowlist;
   - fail when `@layer legacy` is reintroduced;
   - keep the test implementation dependency-free and understandable from its
     failure message.
9. Remove the temporary ownership inventory after its durable information is
   represented in `STYLE_MAP.md` and the regression test.

### Migration sequence

Use this order to keep each extraction independently verifiable:

1. audit-preparation dialog;
2. general-audit summary graphics;
3. remaining general-audit view;
4. history view;
5. Practice Guide;
6. benchmark audit sections, splitting token, evidence, recommendation, or
   participant presentation further when ownership remains unclear;
7. shell, navigation, top bar, and empty state;
8. global foundation consolidation and final legacy-layer removal.

Do not wait until the end to verify. Build, inspect, and remove duplicate
fallback selectors after each owner is migrated.

### Migration constraints

- Preserve the current visual design, responsive behavior, visible text,
  keyboard behavior, and interface state transitions.
- Preserve the current React data flow. Presentation extraction must not move
  service reads, scoring, projection, provider capability discovery, or audit
  mutations into view components.
- Preserve the signal-color meanings defined in `DESIGN.md`.
- Preserve the observer-only dashboard and preparation-only request dialog.
- Preserve CSS cascade behavior during extraction. Do not rely on a module's
  eventual bundle order to reproduce an undocumented global override.
- Keep shared custom properties global; do not duplicate token values across
  modules.
- Keep feature breakpoints beside their owner. Only document-wide responsive
  behavior may remain in `base.css`.
- Keep wide tables and maps responsible for their own horizontal scrolling.
  The document must not gain horizontal overflow.
- Do not introduce `!important`, CSS-in-JS, Sass, a utility-class migration, a
  styling library, or a new CSS-processing dependency.
- Do not minify source or compress multiple declarations onto one line to meet
  a line-count target.
- Do not create class-name composition dependencies between CSS Modules.
- Avoid one-class files and excessive fragmentation. A module should represent
  a coherent component surface.
- Preserve unrelated user changes in the existing dirty worktree.

### Likely files

- `app/globals.css`
- `app/page.tsx`
- `app/styles/STYLE_MAP.md`
- New `app/styles/tokens.css`
- New `app/styles/base.css`
- New `app/styles/primitives.css`
- `app/prepare-audit-dialog.tsx`
- New `app/prepare-audit-dialog.module.css`
- `app/general-audit-view.tsx`
- New `app/general-audit-view.module.css`
- `app/general-audit-graphics.tsx`
- New `app/general-audit-graphics.module.css`
- Existing investigation component and module
- New focused view components and modules for the shell, benchmark audit,
  history, and Practice Guide
- New `tests/style-ownership.test.mjs`
- Existing rendered HTML and UI tests where ownership assertions belong

### Non-goals

- Do not redesign or restyle the interface.
- Do not change audit report, service, persistence, CLI, scoring, or provider
  contracts.
- Do not change which information is visible in any report state.
- Do not replace Tailwind, introduce a design-system package, or convert the
  product to a utility-first styling approach.
- Do not rename user-facing labels.
- Do not make every repeated declaration a global primitive. Similar-looking
  feature elements may remain independently owned when their behavior differs.
- Do not optimize for the fewest possible files or the fewest possible source
  lines. Optimize for the smallest reliable context an agent must inspect for
  one change.

### Acceptance criteria

- `app/globals.css` is an import-only manifest with no product-feature
  selectors.
- Tokens have one canonical definition, and `@layer legacy` no longer exists.
- Every feature selector is scoped through an owning CSS Module.
- Every remaining global class is explicitly allowlisted and documented in
  `STYLE_MAP.md`.
- `app/page.tsx` is a composition and state-coordination owner rather than the
  markup owner for benchmark audit, history, Practice Guide, and shell
  presentation.
- An unfamiliar agent can locate the stylesheet, states, breakpoints, and
  shared dependencies for any major interface surface from `STYLE_MAP.md`
  without searching all CSS files.
- No owner module exceeds roughly 600 lines without a documented reason and a
  clear internal section map.
- No migrated selector has a duplicate fallback in shared or global CSS.
- The ownership regression test prevents feature rules or a legacy override
  layer from accumulating in `globals.css`.
- Desktop and narrow rendering match the current interface for complete,
  active, partial, failed, empty, incompatible-history, unavailable-token, and
  preparation-dialog states.
- All interactive controls retain their accessible names, native semantics,
  focus visibility, and keyboard behavior.
- At approximately `390px`, `document.body.scrollWidth` does not exceed the
  viewport; tabs, tables, matrices, and maps scroll only within their intended
  containers.

### Verification

- Run `npm run build` after each owner migration.
- Run `npm test`.
- Run `npm run lint`.
- Run the focused style-ownership and rendered HTML tests.
- Confirm `rg "@layer legacy|\\.active|\\.is-|\\.status-" app/globals.css
  app/styles` returns only documented semantic exceptions, ideally none.
- Confirm no product prefix documented in `STYLE_MAP.md` remains in
  `globals.css`, `tokens.css`, `base.css`, or outside its owning module.
- Visually inspect at desktop width:
  - active and completed benchmark reports;
  - general-audit progress, evidence, recommendation, summary-graphics, and
    investigation tabs;
  - history;
  - Practice Guide;
  - empty and failed states;
  - the complete audit-preparation dialog flow.
- Visually inspect the same owners at approximately `390px`, including all
  intentional horizontal-scroll containers.
- Confirm browser diagnostics contain no new errors or warnings.
- Confirm the production CSS contains the expected module rules once, without
  legacy fallback copies.

---
