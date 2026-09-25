// Shared helpers for the Playwright test suite.
// Test data rule: everything here and in every *.spec.js file is synthetic,
// obviously-fake data (e.g. "Testmed A", "10 mg") — never real medication
// names, values, or personal data, since this repo is public.

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return isoDate(dt);
}

function today() {
  return isoDate(new Date());
}

// A minimal, fully-migrated empty state matching what load() produces.
function blankState(overrides = {}) {
  const settings = { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [], backupWarnDismissed: null,
    alerts: { sysMin: null, sysMax: null, diaMin: null, diaMax: null, gMin: null, gMax: null, pMin: null, pMax: null, action: '' },
    measurementSchedule: Object.fromEntries(['w', 'g', 'k', 'bp', 'p'].map(id => [id, { mode: 'daily', weekdays: [] }])),
    ...overrides.settings };
  if (!Object.prototype.hasOwnProperty.call(overrides.settings || {}, 'carbGoalHistory')) settings.carbGoalHistory = [{ date: null, value: settings.carbGoal }];
  if (!Object.prototype.hasOwnProperty.call(overrides.settings || {}, 'alertHistory')) settings.alertHistory = [{ date: null, value: { ...settings.alerts } }];
  return {
    dataVersion: 6,
    days: {},
    weeks: {},
    labs: [],
    labDates: { base: '', end: '' },
    doseChanges: [],
    archive: [],
    refRead: {},
    ...overrides,
    settings,
  };
}

async function gotoApp(page) {
  await page.goto('/index.html');
}

// Seeds localStorage with `state` and reloads so the app's in-memory S picks
// it up. The page must already be navigated to the app (same-origin) first.
async function seed(page, state) {
  await page.evaluate((s) => localStorage.setItem('ketoProtokoll_v1', JSON.stringify(s)), state);
  await page.reload();
}

module.exports = { isoDate, addDays, today, blankState, gotoApp, seed };
