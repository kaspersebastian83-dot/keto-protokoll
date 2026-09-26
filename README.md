# Keto-Protokoll

Single-file offline-capable web app for documenting a ketogenic diet trial:
daily and weekly measurements, laboratory values, medication adherence and trends,
with a printable weekly fridge sheet and a report for discussion with a doctor.

## Usage

Open `index.html` in a browser – no build step or runtime dependencies.
Or use the GitHub Pages version to open it on the phone and install it as an app (see below).

## Install as an app (PWA)

Served over HTTPS (e.g. GitHub Pages), the app can be added to the home screen
via the browser's "Add to Home Screen" option (Safari/Chrome) and then opens
without browser chrome, like a native app. It also keeps working offline once
it's been opened online at least once.

This only works over HTTPS – opening `index.html` directly (`file://`) skips
it silently, no PWA install prompt and no offline support in that case.

## Data & privacy

- All entries live **only in the browser's localStorage** on the device you use.
  Nothing is sent anywhere, and nothing ends up in this repository.
- Backup import can keep a browser-local recovery snapshot of the state that existed immediately before import. This remains local and is separate from exported backups.
- Phone and PC have separate storage. Use *Einstellungen → Backup speichern / laden* to move data between devices.
- Backups (`*.json`) and exports (`*.csv`) are git-ignored on purpose. Keep them out of the repo.
- localStorage is tied to the exact URL/origin. Opening the file locally and via GitHub Pages
  means two separate data stores. Pick one per device.

## Structure

- `index.html` – the whole app (HTML, CSS, vanilla JS)
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` – PWA install + offline support
- Storage key: `ketoProtokoll_v1`

## Features

- Daily tracking: weight, fasting glucose, blood ketones, two morning blood-pressure readings with a derived daily average, pulse, carbohydrates, energy and hunger, plan adherence, symptoms and notes, and medication adherence
- Weekly tracking: waist, resting heart rate, sleep, stress, steps, and weekly notes; Today can remind you when the current or recent check-in is due and open the existing Week form
- Laboratory tracking: baseline and follow-up values, reference ranges, and changes over time
- Measurement schedules: configure the five objective morning measurements as daily, selected weekdays, or optional
- Today: schedule-aware completion count; completed scheduled entries collapse accessibly, while non-due measurements remain available. Historical and future dates keep the full entry layout
- Optional local-only Commitment Mode: progress through the existing experiment, the daily Ja/Teils/Nein answer, and a factual rolling adherence summary
- Trends: seven longitudinal charts, linear trend fitting, an experiment overview and data-quality summary, trend readiness, and a modeled current-period summary across 14 metrics
- Historical comparison: compare current and archived period trends descriptively, without ranking or claims of significance or causation
- Two-variable comparison: compare two selected values over time
- Medication tracking: medications and supplements, daily adherence, and dose-change history
- Doctor-agreed alert thresholds
- Tracking periods: extend an active period, archive a period, start a new period, regenerate archived reports, and compare the current period descriptively with an archived period
- Literature: curated references, reading progress, and references included in the doctor report
- Print: weekly A4 landscape fridge sheet, final doctor report, and saving as PDF through the browser print dialog
- Data safety: local-only storage, JSON backup and restore, browser-local recovery around backup import, CSV export, schema migration, backup reminders, and persistent-storage request where supported
- Installable PWA: home-screen installation, offline support, and GitHub Pages compatibility
- Automated Playwright regression tests
- GitHub Actions CI
