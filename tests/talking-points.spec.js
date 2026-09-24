const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, addDays } = require('./helpers');

const START = '2026-01-05';

function baseState(overrides) {
  return blankState({
    settings: { name: '', start: START, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
    ...overrides,
  });
}

test.describe('generateTalkingPoints()', () => {
  test('trend check fires on a sustained divergence and stays silent otherwise', async ({ page }) => {
    await gotoApp(page);
    const state = baseState();
    // Weeks 1-2 baseline 90kg, weeks 3-6 steady at 85kg (sustained divergence through the last week with data).
    for (let w = 0; w < 6; w++) {
      const wt = w < 2 ? 90 : 85;
      for (let d = 0; d < 7; d++) state.days[addDays(START, w * 7 + d)] = { w: wt };
    }
    await seed(page, state);
    const pts = await page.evaluate(() => generateTalkingPoints());
    expect(pts.some((p) => p.includes('Gewicht seit Woche 3'))).toBe(true);

    // Silent case: flat weight across all weeks.
    const flat = baseState();
    for (let w = 0; w < 6; w++) {
      for (let d = 0; d < 7; d++) flat.days[addDays(START, w * 7 + d)] = { w: 80 };
    }
    await seed(page, flat);
    const ptsFlat = await page.evaluate(() => generateTalkingPoints());
    expect(ptsFlat.some((p) => p.includes('Gewicht seit Woche'))).toBe(false);
  });

  test('carb-vs-ketone check fires with 5+ days per group and a >=0.3 mmol/l gap', async ({ page }) => {
    await gotoApp(page);
    const state = baseState();
    for (let i = 0; i < 6; i++) state.days[addDays(START, i)] = { c: 80, k: 0.5 }; // over limit
    for (let i = 10; i < 16; i++) state.days[addDays(START, i)] = { c: 20, k: 1.2 }; // within limit
    await seed(page, state);
    const pts = await page.evaluate(() => generateTalkingPoints());
    expect(pts.some((p) => p.includes('Kohlenhydrat-Limit') && p.includes('Ketonwerte'))).toBe(true);

    // Silent case: fewer than 5 days in one group.
    const sparse = baseState();
    for (let i = 0; i < 2; i++) sparse.days[addDays(START, i)] = { c: 80, k: 0.5 };
    for (let i = 10; i < 16; i++) sparse.days[addDays(START, i)] = { c: 20, k: 1.2 };
    await seed(page, sparse);
    const ptsSparse = await page.evaluate(() => generateTalkingPoints());
    expect(ptsSparse.some((p) => p.includes('Ketonwerte'))).toBe(false);
  });

  test('symptom frequency check fires on a >=2 shift between period halves', async ({ page }) => {
    await gotoApp(page);
    // The check only scans the app's own fixed symptom vocabulary (SYMS), not
    // arbitrary strings, so this test uses whichever value is first in that
    // built-in list rather than a made-up name.
    const sym = await page.evaluate(() => SYMS[0]);
    const state = baseState();
    // 5 occurrences in the second half (day index >= N()/2 = 45), 0 in the first half.
    for (let i = 50; i < 55; i++) state.days[addDays(START, i)] = { sym: [sym] };
    await seed(page, state);
    const pts = await page.evaluate(() => generateTalkingPoints());
    expect(pts.some((p) => p.includes('ersten Hälfte') && p.includes('zweiten Hälfte'))).toBe(true);

    // Silent case: fewer than 3 total mentions.
    const sparse = baseState();
    sparse.days[addDays(START, 50)] = { sym: [sym] };
    await seed(page, sparse);
    const ptsSparse = await page.evaluate(() => generateTalkingPoints());
    expect(ptsSparse.some((p) => p.includes('ersten Hälfte'))).toBe(false);
  });

  test('dose-change check fires on a >=5 mmHg sys shift around a logged dose change', async ({ page }) => {
    await gotoApp(page);
    const doseDate = addDays(START, 20);
    const state = baseState({
      settings: { name: '', start: START, days: 90, carbGoal: 50, questions: '', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '20 mg', category: 'Medikament' }] },
      doseChanges: [{ date: doseDate, medId: 'medA', oldDose: '10 mg', newDose: '20 mg' }],
    });
    for (let i = 0; i < 90; i++) {
      const ds = addDays(START, i);
      const diff = i - 20;
      state.days[ds] = state.days[ds] || {};
      state.days[ds].sys = (diff >= 1 && diff <= 7) ? 113 : 125;
    }
    await seed(page, state);
    const pts = await page.evaluate(() => generateTalkingPoints());
    expect(pts.some((p) => p.includes('Testmed A') && p.includes('Blutdruck'))).toBe(true);

    // Silent case: no logged dose changes at all.
    const noChange = baseState();
    for (let i = 0; i < 90; i++) noChange.days[addDays(START, i)] = { sys: 120 };
    await seed(page, noChange);
    const ptsNone = await page.evaluate(() => generateTalkingPoints());
    expect(ptsNone.some((p) => p.includes('Anpassung'))).toBe(false);
  });

  test('capture-rate caveat fires only below 70%, silent when all fields are well logged', async ({ page }) => {
    await gotoApp(page);
    const state = baseState();
    // Only 5 of 90 days have 'g' logged -> well under 70%.
    for (let i = 0; i < 5; i++) state.days[addDays(START, i)] = { g: 95 };
    await seed(page, state);
    const pts = await page.evaluate(() => generateTalkingPoints());
    expect(pts.some((p) => p.includes('Blutzucker') && p.includes('% der Tage erfasst'))).toBe(true);

    // Silent case: well-logged fields don't get a caveat. Uses a short period so full coverage is easy to seed.
    const wellLogged = blankState({ settings: { name: '', start: START, days: 7, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    for (let i = 0; i < 7; i++) wellLogged.days[addDays(START, i)] = { w: 80, g: 95, k: 1, sys: 120 };
    await seed(page, wellLogged);
    const ptsFull = await page.evaluate(() => generateTalkingPoints());
    expect(ptsFull.some((p) => p.includes('% der Tage erfasst'))).toBe(false);
  });
});
