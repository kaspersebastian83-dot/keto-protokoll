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

### Weekly tracking

Includes weekly and Garmin-related measurements such as:

- waist
- resting heart rate
- sleep
- stress
- steps
- notes

### Laboratory tracking

Supports:

- baseline values
- follow-up values
- reference ranges
- change over time

### Trends and summaries

Includes:

- longitudinal charts
- linear trend calculations
- two-variable comparison chart
- summary tables
- observations generated from recorded data

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

### Tracking periods

Users can:

- extend a current period
- archive a completed period
- start a new period
- regenerate reports for archived periods

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
- trend calculations
- comparison charts
- literature
- print output
- PWA behavior
- alert thresholds
- version synchronization

GitHub Actions runs tests on pushes and pull requests.

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

### Priority 0 — Project infrastructure

- [x] Add `AGENTS.md`
- [x] Add `PROJECT.md`
- [x] Update `README.md`
- [x] Review obsolete development branches
- [ ] Adopt feature-branch and pull-request workflow

### Future development

Future features should be defined before implementation.

Potential areas include:

- improved longitudinal summaries
- better experiment-level overview
- improved daily-entry UX
- data-quality indicators
- historical period comparison
- accessibility improvements
- continued mobile refinement

These are ideas, not committed requirements.
