# Keto-Protokoll

Single-file offline web app for logging a 3-month ketogenic diet trial:
daily morning values, weekly Garmin averages, lab values before/after,
a printable weekly fridge sheet and a summary report for the final doctor's appointment.

## Usage

Open `index.html` in a browser – no build step, no dependencies.
Or use the GitHub Pages version (see below) to open it on the phone.

## Data & privacy

- All entries live **only in the browser's localStorage** on the device you use.
  Nothing is sent anywhere, and nothing ends up in this repository.
- Phone and PC have separate storage. Use *Einstellungen → Backup speichern / laden* to move data between devices.
- Backups (`*.json`) and exports (`*.csv`) are git-ignored on purpose. Keep them out of the repo.
- localStorage is tied to the exact URL/origin. Opening the file locally and via GitHub Pages
  means two separate data stores. Pick one per device.

## Structure

- `index.html` – the whole app (HTML, CSS, vanilla JS)
- Storage key: `ketoProtokoll_v1`

## Features

- Daily: weight, fasting glucose, blood ketones, blood pressure, pulse, carbs, energy/hunger (1–5), plan adherence, symptoms, note
- Weekly: waist, resting HR, sleep, stress, steps (Garmin), note
- Lab table with baseline/final values and deltas
- Charts (inline SVG)
- Print: weekly A4 landscape fridge sheet (blank or pre-filled), summary report (A4 portrait / PDF)
- JSON backup/restore, CSV export
