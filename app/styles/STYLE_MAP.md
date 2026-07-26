# Interface style ownership

`app/globals.css` is an import-only manifest. Follow the owner below before
searching other stylesheets.

## Global foundation

- `tokens.css` owns the one canonical `:root` token set.
- `base.css` owns box sizing, document defaults, native control inheritance,
  reduced-motion defaults, and global focus visibility.
- `primitives.css` owns the global class allowlist:
  - `panel`
  - `panel-heading`
  - `page-content`
  - `section-kicker`
  - `muted-action`
  - `empty-report-state`

These classes are global because at least three independent view owners consume
them. Feature modules refer to a shared class with `:global(...)` only when a
compound selector is required. No other global class is permitted.

## Component owners

| Owner | Stylesheets | States and breakpoints |
| --- | --- | --- |
| `shell.tsx` | `shell.module.css` | `aria-current`, connection/pairing `data-status`; 1050px, 900px, 640px |
| `prepare-audit-dialog.tsx` | `prepare-audit-dialog.module.css` | native dialog `open`, `data-span`, capability `data-status`; 760px |
| `general-audit-view.tsx` | `general-audit-view.module.css`, `general-audit-findings.module.css`, `general-audit-recommendations.module.css` | report/stage `data-status`, finding `data-state` and `data-signal`, `aria-selected`; 900px, 680px |
| `general-audit-graphics.tsx` | `general-audit-graphics.module.css` | dimension `data-state`, coverage/status attributes, `aria-pressed`; 680px |
| `general-audit-investigation-graphics.tsx` | `general-audit-investigation-graphics.module.css` | `data-state`, `data-current`, `data-availability`, `data-partial`, `aria-selected`; 760px |
| `benchmark-audit-view.tsx` | `benchmark-audit-view.module.css`, `benchmark-summary.module.css`, `benchmark-execution.module.css`, `benchmark-token-usage.module.css`, `benchmark-evidence.module.css`, `benchmark-practice.module.css`, `benchmark-recommendations.module.css` | run/phase/token `data-status`, `data-layout`, `data-compact`, `data-token-kind`, `data-tone`; 1050px, 900px, 860px, 760px, 640px, 560px |
| `history-view.tsx` | `history-view.module.css` | score `data-status`, `data-interactive`; 900px, 640px |
| `practice-guide-view.tsx` | `practice-guide-view.module.css`, `practice-guide-examples.module.css`, `practice-guide-structure.module.css` | `aria-expanded`, `aria-pressed`, card `data-state`; 900px, 640px |

`page.tsx` coordinates live data, selected history, and the active top-level
view. It intentionally uses the benchmark summary module only for the saved
report banner. The shell owns the shared page-content frame and live empty
state.

## Module size notes

The investigation graphics module is intentionally larger than the usual
roughly 600-line ceiling. Its five progressively disclosed graphics share one
tab owner, one state vocabulary, one 760px overflow contract, and a single
React component established by NAV-01; splitting its selectors would make one
interaction require multiple ownership paths. Benchmark and Practice Guide
styles are split into named presentation sections instead.

There are no cross-owner class composition dependencies. Shared tokens are
global custom properties, and the six allowlisted primitives are the only
global class dependency.
