# Keto-Protokoll

## Purpose

Keto-Protokoll is a privacy-first personal health-tracking application for documenting a ketogenic diet trial over several weeks or months.

Its goals are:
- make daily tracking quick and low-friction
- visualize meaningful changes over time
- preserve user privacy and offline usability
- support structured discussion with a doctor
- generate useful printable summaries

It is a tracking and documentation tool, not a diagnostic system.

## Product principles

- privacy first
- health data stays local
- offline capable
- low-friction daily use
- mobile friendly
- understandable without statistical expertise
- cautious medical interpretation
- reliable over long tracking periods
- backward-compatible user data
- useful printable output

## Current architecture

The project intentionally uses a simple architecture.

Main components:

- `index.html`
  - application HTML
  - CSS
  - vanilla JavaScript
  - most application logic

- `sw.js`
  - service worker
  - offline caching

- `manifest.json`
  - PWA configuration

- `tests/`
  - Playwright regression tests

- `.github/workflows/test.yml`
  - GitHub Actions CI

- GitHub Pages
  - production deployment

There is currently no frontend framework and no build step for the application itself.

The single-file application architecture is intentional for now. It should only be refactored when it materially limits reliability, testing, maintenance, or future development.

## Data storage

Application data is stored in browser localStorage.

Storage key:

`ketoProtokoll_v1`

Important stored data includes:

- settings
- daily measurements
- weekly measurements
- laboratory values
- medications
- medication adherence
- dose changes
- alert thresholds
- tracking periods
- archived periods
- literature reading state

Schema upgrades use the existing migration mechanism.

Existing user data and older compatible backups should be preserved whenever possible.

## Current major features

### Daily tracking

Includes:

- weight
- fasting glucose
- blood ketones
- blood pressure
- pulse
- carbohydrates
- energy
- hunger
- diet adherence
- symptoms
- notes
- medication adherence

Blood pressure supports two morning measurements and derives a daily value for existing charts, trends, reports and alerts.

The five objective morning measurements can be scheduled daily, on selected weekdays, or marked optional. On the actual current day, Today emphasizes scheduled measurements, shows their completion count, and lets completed entries collapse into accessible disclosures. Non-due measurements remain available under additional measurements. Historical and future dates retain the full-entry layout.

### Weekly tracking

Includes weekly and Garmin-related measurements such as:

- waist
- resting heart rate
- sleep
- stress
- steps
- notes

When due, Today can remind the user about the current or recent weekly check-in and link to the existing Week form. It does not duplicate that form.

### Laboratory tracking

Supports:

- baseline values
- follow-up values
- reference ranges
- change over time

### Trends and summaries

Includes:

- seven longitudinal charts and the existing linear trend calculations
- an experiment overview with elapsed-period status and data-quality/data-basis summaries
- trend-readiness information and a modeled trend summary for the current period across the same 14 numerical metrics
- historical comparison of the current period with an archived period
- the existing two-variable comparison chart
- descriptive observations from recorded data to support doctor discussion

Modeled endpoints are descriptive estimates, not individual first or last readings. Historical comparison does not rank periods. These summaries do not claim statistical significance or causation.

### Medication tracking

Includes:

- medications
- supplements
- daily adherence
- dose-change history

### Doctor discussion support

Includes:

- doctor-agreed alert thresholds
- recorded-data observations
- questions for a medical consultation
- final doctor report

The application must not present generated observations as diagnoses.

### Print output

Includes:

- weekly A4 landscape fridge sheet
- final doctor report

### Data safety

Includes:

- JSON backup
- backup restore
- CSV export
- schema migration
- backup reminders
- persistent-storage request where supported
- a browser-local recovery snapshot around backup import, with lifecycle-safe import and recovery behavior

### Tracking periods

Users can:

- extend a current period
- archive a period
- start a new period
- regenerate reports for archived periods
- compare the current period descriptively with an archived period

### Literature

Includes:

- curated references
- reading progress
- references in the doctor report

### PWA

The application can:

- be installed to a home screen
- operate offline after initial loading
- run through GitHub Pages

## Testing

The project uses Playwright regression tests.

Important coverage includes:

- daily entry
- blood pressure
- plausibility checks
- medication tracking
- laboratory values
- backup and restore
- data migration
- period handling
- measurement scheduling
- Today completion behavior
- weekly check-in reminders
- experiment overview and data-quality summaries
- experiment trend summaries
- historical period comparison
- archive migration and archived reports
- trend calculations
- comparison charts
- literature
- print output
- PWA behavior
- alert thresholds
- version synchronization

GitHub Actions runs tests on pushes and pull requests.
CI covers Chromium, Playwright WebKit, and focused iPhone 13 emulation in mobile WebKit. Linux WebKit coverage does not replace testing on a physical iPhone or Safari on macOS.

## Development workflow

Preferred workflow:

1. discuss and define one coherent change
2. create a dedicated branch
3. inspect the existing implementation
4. implement the smallest robust solution
5. add or update regression tests
6. run focused tests
7. run the full Playwright test suite
8. review the diff
9. push the branch
10. create a pull request
11. review the pull request
12. merge into `main`

`main` should represent the known-good production version.

## Things that must remain reliable

- existing stored user data
- backup restore
- schema migration
- offline use
- PWA installation
- GitHub Pages deployment
- mobile and iOS usability
- print output
- trend calculations
- medication history
- archived tracking periods
- version synchronization

## Current development priorities

### Priority 0 — Project infrastructure — COMPLETE

- [x] Add `AGENTS.md`
- [x] Add `PROJECT.md`
- [x] Update `README.md`
- [x] Review obsolete development branches
- [x] Adopt feature-branch and pull-request workflow

### P1 — Historical correctness and data safety — COMPLETE

Established privacy and release safeguards, archived-state migration, medication lifecycle history, dated goals and doctor-agreed thresholds, backup and recovery hardening, and WebKit/mobile regression coverage.

### P2 — Measurement schedule and low-friction Today UX — COMPLETE

Added configurable measurement schedules, the schedule-aware Today view, the weekly check-in reminder, and mobile/accessibility polish.

### P3 — Experiment overview and longitudinal summaries — COMPLETE

- P3.1: experiment overview and data-quality foundation
- P3.2: current-period trend summary
- P3.3: historical period comparison

P3 provides descriptive analysis only. It does not add diagnostic, causal, ranking, or health-scoring behavior.

### P4 — Analysis presentation and comparison UX — IN PROGRESS

Purpose: improve how existing analysis is presented and explored without changing the underlying health interpretation model.

#### P4.1 — Chart readability and context — COMPLETE

The seven fixed Verlauf charts now show titles, units, plotted-value counts, configured-period and observation context, clearer empty states, a non-color BP series distinction, readable narrow-screen chart scrolling, and accessible descriptions. Chart mathematics and medical interpretation are unchanged.

#### P4.2 — Historical comparison visualization — COMPLETE

Potential goals include visual presentation of current and archived-period trends using P3.3 period and cutoff semantics. The presentation should avoid winner/better/worse framing and should not imply equal observation windows when they differ. This is a visualization extension of P3.3, not new medical analysis.

#### P4.3 — Two-variable comparison UX — PLANNED

Potential goals include improving the existing Wert A / Wert B workflow, selected-variable context, axis and unit labels, mobile presentation, and empty or insufficient-data states. Correlation coefficients, significance testing, and causal interpretation are out of scope; they would require a separately defined evidence/statistics phase.

#### P4.4 — Analysis accessibility and final polish — PLANNED

Potential goals include keyboard and accessibility review, responsive behavior, screen-reader-friendly labels, print/screen consistency where relevant, and consistency across overview, summary, charts, and comparison views.

Remaining P4 subphases are roadmap directions. Each must be inspected and scoped before implementation. Their bullets are not committed requirements.

### Later possibilities

Uncommitted possibilities include an evidence/library refresh, onboarding/help improvements, import/convenience features, continued mobile refinement, and optional deeper statistical analysis only after explicit statistical and medical design review.

The project does not promise diagnosis, personalized treatment advice, automatic health scoring, causal inference, or predictive disease models.
