# Interface style ownership

## General-audit investigation graphics

- Component: `app/general-audit-investigation-graphics.tsx`
- Owned stylesheet: `app/general-audit-investigation-graphics.module.css`
- Scope: graphic tabs, behavior-path maps, discovery journeys, finding
  evolution, recommendation impact/effort, dimension history, citations, and
  legends.
- Shared global primitives intentionally consumed from `app/globals.css`:
  `panel`, `panel-heading`, `section-kicker`, `muted-action`, and
  `empty-report-state`.
- State attributes:
  - `data-state` carries behavior-path evidence states, located-late journey
    state, and finding-revision states.
  - `data-current` identifies the current finding revision.
  - `data-availability` carries measured, recorded, or unavailable journey-step
    availability.
  - `data-partial` identifies partial historical runs.
  - `aria-selected` is the visual and semantic selected state for graphic tabs.
- Responsive breakpoint: the feature-owned narrow layout is colocated in the
  module at `max-width: 760px`.

The remaining feature styles in `app/globals.css` are still awaiting scoped
extraction. Tokens, reset rules, and shared primitives remain global.
