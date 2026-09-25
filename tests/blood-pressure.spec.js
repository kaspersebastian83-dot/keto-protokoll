const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('Two blood pressure readings, averaged', () => {
  test('derived sys/dia average two readings, or fall back to whichever single reading exists', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    // Only reading 1: derived value equals it exactly.
    await page.fill('#f_sys1', '120');
    await page.locator('#f_sys1').blur();
    await page.fill('input[data-f="dia1"]', '80');
    await page.locator('input[data-f="dia1"]').blur();
    let d = await page.evaluate(() => S.days[today()]);
    expect(d.sys).toBe(120);
    expect(d.dia).toBe(80);

    // Both readings: derived value is the average, rounded.
    await page.fill('#f_sys2', '131');
    await page.locator('#f_sys2').blur();
    await page.fill('input[data-f="dia2"]', '85');
    await page.locator('input[data-f="dia2"]').blur();
    d = await page.evaluate(() => S.days[today()]);
    expect(d.sys).toBe(Math.round((120 + 131) / 2)); // 126 (125.5 rounds up)
    expect(d.dia).toBe(Math.round((80 + 85) / 2)); // 83 (82.5 rounds up)

    // Clearing reading 1 falls back to reading 2 alone.
    await page.fill('#f_sys1', '');
    await page.locator('#f_sys1').blur();
    await page.fill('input[data-f="dia1"]', '');
    await page.locator('input[data-f="dia1"]').blur();
    d = await page.evaluate(() => S.days[today()]);
    expect(d.sys).toBe(131);
    expect(d.dia).toBe(85);
  });

  test('the average line only appears once both readings are fully filled', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await expect(page.locator('#bpAvg')).toBeHidden();

    await page.fill('#f_sys1', '120');
    await page.locator('#f_sys1').blur();
    await page.fill('input[data-f="dia1"]', '80');
    await page.locator('input[data-f="dia1"]').blur();
    await expect(page.locator('#bpAvg')).toBeHidden(); // only one reading so far

    await page.fill('#f_sys2', '128');
    await page.locator('#f_sys2').blur();
    await page.fill('input[data-f="dia2"]', '82');
    await page.locator('input[data-f="dia2"]').blur();

    await expect(page.locator('#bpAvg')).toBeVisible();
    await expect(page.locator('#bpAvg')).toHaveText('Ø 124/81');
  });

  test('plausibility checks apply to each reading independently and never block saving', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    // Reading 1 out of range.
    await page.fill('#f_sys1', '250');
    await page.locator('#f_sys1').blur();
    await page.fill('input[data-f="dia1"]', '80');
    await page.locator('input[data-f="dia1"]').blur();
    await expect(page.locator('#hint_bp1')).toBeVisible();
    await expect(page.locator('#hint_bp2')).toBeHidden();

    // Reading 2 has systolic not higher than diastolic.
    await page.fill('#f_sys2', '70');
    await page.locator('#f_sys2').blur();
    await page.fill('input[data-f="dia2"]', '90');
    await page.locator('input[data-f="dia2"]').blur();
    await expect(page.locator('#hint_bp2')).toBeVisible();

    // Both readings still saved exactly as typed — hints are advisory only.
    const d = await page.evaluate(() => S.days[today()]);
    expect(d.sys1).toBe(250);
    expect(d.dia1).toBe(80);
    expect(d.sys2).toBe(70);
    expect(d.dia2).toBe(90);
  });

  test('a soft hint appears when the two readings diverge by more than 15 mmHg systolic, but never blocks saving', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_sys1', '120');
    await page.locator('#f_sys1').blur();
    await page.fill('input[data-f="dia1"]', '80');
    await page.locator('input[data-f="dia1"]').blur();
    await page.fill('#f_sys2', '138'); // 18 mmHg apart
    await page.locator('#f_sys2').blur();
    await page.fill('input[data-f="dia2"]', '80');
    await page.locator('input[data-f="dia2"]').blur();

    await expect(page.locator('#hint_bpdiff')).toBeVisible();
    await expect(page.locator('#hint_bpdiff')).toHaveText(/weichen stark ab/);
    const d = await page.evaluate(() => S.days[today()]);
    expect(d.sys1).toBe(120);
    expect(d.sys2).toBe(138); // advisory only, both values saved

    // 15 mmHg exactly is not "more than 15" -> no hint.
    await page.fill('#f_sys2', '135');
    await page.locator('#f_sys2').blur();
    await expect(page.locator('#hint_bpdiff')).toBeHidden();
  });

  test('migrate() turns an existing single sys/dia reading into reading 1, leaving sys/dia untouched', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => migrate({
      dataVersion: 1,
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      days: { [today()]: { w: 80, sys: 118, dia: 76 } },
      weeks: {}, labs: [], labDates: { base: '', end: '' }, doseChanges: [], archive: [], refRead: {},
    }));

    expect(result.dataVersion).toBe(4);
    const day = result.days[today()];
    expect(day.sys1).toBe(118);
    expect(day.dia1).toBe(76);
    expect(day.sys).toBe(118); // untouched — single reading stays valid as the derived value
    expect(day.dia).toBe(76);
    expect(day.sys2).toBeUndefined();
    expect(day.dia2).toBeUndefined();
  });

  test('load() migrates an old single-reading day on the actual Heute view', async ({ page }) => {
    await gotoApp(page);
    const oldBackup = {
      dataVersion: 1,
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      days: { [today()]: { w: 80, sys: 118, dia: 76 } },
      weeks: {}, labs: [], labDates: { base: '', end: '' }, doseChanges: [], archive: [], refRead: {},
    };
    await page.evaluate((d) => localStorage.setItem('ketoProtokoll_v1', JSON.stringify(d)), oldBackup);
    await page.reload();

    await expect(page.locator('#f_sys1')).toHaveValue('118');
    await expect(page.locator('input[data-f="dia1"]')).toHaveValue('76');
    await expect(page.locator('#f_sys2')).toHaveValue('');
    const d = await page.evaluate(() => S.days[today()]);
    expect(d.sys).toBe(118);
    expect(d.dia).toBe(76);
  });

  test('derived sys/dia feed the existing BP chart unchanged', async ({ page }) => {
    await gotoApp(page);
    const start = today();
    const state = blankState({ settings: { name: '', start, days: 30, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    // Three days is the minimum trendFit() needs; two readings on some, one on another.
    state.days[addDays(start, 0)] = { sys1: 120, dia1: 80, sys2: 130, dia2: 84 };
    state.days[addDays(start, 1)] = { sys1: 122, dia1: 79 };
    state.days[addDays(start, 2)] = { sys1: 118, dia1: 77, sys2: 118, dia2: 77 };
    await seed(page, state);

    const chartHTML = await page.evaluate(() => {
      const pairs = [];
      for (let i = 0; i <= 2; i++) {
        const d = S.days[addDays(S.settings.start, i)];
        if (d && d.sys != null) pairs.push(d.sys);
      }
      return pairs;
    });
    // Day 1: avg(120,130)=125; day 2: 122 alone; day 3: avg(118,118)=118 — exactly what the chart/trend consumers read from d.sys.
    expect(chartHTML).toEqual([125, 122, 118]);
  });

  test('report notes how many days had two readings vs. one', async ({ page }) => {
    await gotoApp(page);
    const start = today();
    const state = blankState({ settings: { name: 'Test', start, days: 30, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    for (let i = 0; i < 10; i++) state.days[addDays(start, i)] = { sys1: 120, dia1: 80, sys2: 118, dia2: 78 };
    for (let i = 10; i < 15; i++) state.days[addDays(start, i)] = { sys1: 122, dia1: 79 };
    await seed(page, state);

    const html = await page.evaluate(() => reportHTML());
    expect(html).toContain('Blutdruck an 10 Tagen mit zwei Messungen erfasst, an 5 Tagen mit einer.');
  });
});
