# Overview

Waymark’s North Star is **The Evidence Console**: a calm, forensic operating
surface where the active audit, its provenance, and its reliability are obvious
at a glance. The primary design mode is **Operate**—focused, predictable, and
stable during long-running work. Waymark is a personal developer tool, not a
sales surface. Avoid marketing-page theatrics and avoid showing the complete
report at once.

# Colors

- Canvas: `#101216`
- Navigation rail: `#0C0E12`
- Surface: `#191D23`
- Raised surface: `#1E232B`
- Edge: `#2A3039`
- Strong edge: `#38414C`
- Primary text: `#F1F3EE`
- Muted text: `#9CA5B3`
- Active or verified: `#A9D86E`
- Candidate measurement: `#82AEEF`
- Disputed or pending: `#D9A955`
- Contradicted or failed: `#E5796E`

Color is semantic. Do not use signal colors as ambient decoration or glow.

# Typography

Use the local system stack: Segoe UI Variable for interface text and Cascadia
Code for identifiers, paths, token counts, and compact telemetry. Do not fetch
external fonts.

- Hero: 30–48 px, semibold, restrained negative tracking
- Page or section title: 18–28 px, semibold
- Body: 14–16 px, 1.55–1.7 line height
- Operational label: 12–13 px
- Code examples: 13 px minimum, 1.65–1.75 line height
- Never render meaningful text below 11 px
- Keep prose near 65–75 characters per line
- Avoid tiny uppercase kickers and compressed letter spacing

# Elevation

The interface is flat by default. Establish hierarchy with tonal surfaces,
borders, spacing, and type—not stacked shadows.

- Default surface: no shadow
- Nested content: dividers before another container
- Sticky top bar: subtle translucency and blur are permitted
- Popovers and dialogs may use a restrained shadow
- Never use neon glow, radial ambient glow, or glowing status dots

# Components

- Navigation rail: stable position, quiet active marker, explicit labels
- Metric strip: one shared surface with internal dividers
- Panels: 6 px radius, one border, no nested card treatment
- Tables and evidence lists: aligned columns and row dividers
- Status: plain text or compact 4 px labels; reserve pills for true filters
- Progress: linear and labeled; avoid decorative circular meters
- Buttons: visible hover and keyboard focus, restrained transitions
- Report sections: tabs expose Progress, Evidence, and Recommendations one at a
  time
- Audit request preparation: a focused modal with progressive disclosure,
  dependent provider/model/reasoning selects, a read-only prompt preview, and
  one explicit copy action
- Practice comparisons: accordion rows expose one principle at a time
- Large code comparisons: switch between alternatives instead of rendering both
  simultaneously

Spacing follows an 8 px base rhythm with 4 px allowed for fine alignment.
Interactive targets should remain comfortable even when the information density
is high.

# Do’s and Don’ts

Do:

- Lead with the active task, current audit phase, evidence, and reliability.
- Keep token usage, model identity, verification coverage, and mock/live status
  visible.
- Show processed, cached-input, uncached-input, and output tokens separately;
  show budget overruns beside the candidate measurement, not in secondary copy.
- Never infer currency cost without a versioned provider pricing snapshot.
- Use lime, amber, red, and blue only for their defined meanings.
- Prefer dividers and alignment over extra containers.
- Make every state readable without depending on color alone.
- Use progressive disclosure for secondary evidence and reference material.
- Keep “Prepare audit request” visually secondary to the active audit. Opening
  it must not obscure whether an existing run is active.
- Use a keyboard-accessible modal with an explicit title, close action, initial
  focus, validation messages, and focus restoration.
- Label the final action “Copy audit request”; never imply that copying started
  or created an audit.

Don’t:

- Add decorative pulsing, glow, gradients, or oversized circular progress.
- Build equal-weight card grids when the information has a clear hierarchy.
- Nest cards inside cards or give every section its own rounded container.
- Repeat tiny uppercase section labels.
- Use oversized full-sentence headlines inside operational views.
- Show every report section or every guide example at the same time.
- Add chat controls, model invocation, or a start-audit action to the observer
  interface.
- Hardcode model names or reasoning efforts in the modal.
- Put the full generated prompt into the history table or active-audit
  hierarchy.
