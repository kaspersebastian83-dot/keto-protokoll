# Project instructions

- Keto-Protokoll is a privacy-first, offline-capable health-tracking PWA. It uses vanilla HTML, CSS and JavaScript, with most application code in `index.html`.
- Do not introduce a framework or major architectural refactor unless explicitly requested. Prefer small, focused changes and existing helpers over unrelated refactoring.
- Keep health data local. Do not add analytics, telemetry, remote storage, or external transmission of health data unless explicitly requested.
- Preserve the localStorage key `ketoProtokoll_v1`. Keep existing stored data and backups compatible. Make schema changes through the existing migration mechanism.
- Do not put real personal health information in tests or repository files.
- Preserve PWA/offline behavior, GitHub Pages compatibility, and mobile and iOS usability.
- Keep `VERSION` in `index.html`, the `package.json` version, and the `CACHE_NAME` version in `sw.js` synchronized.
- Preserve both print outputs: the fridge sheet and doctor report.
- Medical functionality must distinguish data observations from diagnosis or medical advice. Do not invent medical thresholds; identify doctor-agreed thresholds as such.
- Meaningful bug fixes and features should include regression tests. Before completing a task, run relevant tests and then the full Playwright suite with `npm test`.
- At completion, report changed files, behavior changed, tests added or modified, test results, and remaining risks.
- Review the final diff for unrelated changes before committing.
