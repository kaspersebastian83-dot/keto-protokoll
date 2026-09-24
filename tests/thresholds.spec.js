const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const mmToPx = (mm) => (mm * 96) / 25.4;

function alerts(overrides) {
  return { sysMin: null, sysMax: null, diaMin: null, diaMax: null, gMin: null, gMax: null, pMin: null, pMax: null, action: '', ...overrides };
}

test.describe('Doctor-agreed alert thresholds', () => {
  test('no default thresholds exist on a fresh install', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    const al = await page.evaluate(() => S.settings.alerts);
    expect(al).toEqual(alerts());
  });

  test('an individual BP reading flags even when the two-reading average is inside the limits', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [], alerts: alerts({ sysMax: 130 }) },
      days: { [today()]: { sys1: 150, dia1: 80, sys2: 110, dia2: 80 } }, // average sys = 130, exactly at the limit, not over it
    });
    await seed(page, state);
    const hits = await page.evaluate(() => checkAlerts(S.days[today()]));
    expect(hits.some((h) => h.label.includes('1. Messung') && h.value === 150)).toBe(true);
    // Confirms the average itself would NOT have flagged, so this really is testing per-reading evaluation.
    const avgSys = await page.evaluate(() => S.days[today()].sys);
    expect(avgSys).toBe(130);
  });

  test('unset limits never flag anything, however extreme the value', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      days: { [today()]: { sys1: 250, dia1: 5, g: 500, p: 300 } },
    });
    await seed(page, state);
    const hits = await page.evaluate(() => checkAlerts(S.days[today()]));
    expect(hits).toEqual([]);
  });

  test('day-strip marker and Heute panel appear and disappear as a value crosses the agreed limit', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [], alerts: alerts({ gMax: 180 }) },
      days: { [today()]: { g: 150 } }, // inside the limit
    });
    await seed(page, state);

    await expect(page.locator('#alertWarn')).toHaveCount(0);
    await expect(page.locator(`.strip button[data-date="${today()}"] .alert-dot`)).toHaveCount(0);

    // Cross the limit.
    await page.fill('#f_g', '210');
    await page.locator('#f_g').blur();
    await expect(page.locator('#alertWarn')).toBeVisible();
    await expect(page.locator('#alertWarn')).toContainText('Außerhalb der mit dem Arzt vereinbarten Grenze');
    await expect(page.locator('#alertWarn')).toContainText('Blutzucker');
    await expect(page.locator(`.strip button[data-date="${today()}"] .alert-dot`)).toHaveCount(1);

    // Back inside the limit.
    await page.fill('#f_g', '150');
    await page.locator('#f_g').blur();
    await expect(page.locator('#alertWarn')).toHaveCount(0);
    await expect(page.locator(`.strip button[data-date="${today()}"] .alert-dot`)).toHaveCount(0);
  });

  test('Heute panel includes the configured action text when set', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [], alerts: alerts({ pMax: 100, action: 'Praxis anrufen: 02452 123456' }) },
      days: { [today()]: { p: 130 } },
    });
    await seed(page, state);
    await expect(page.locator('#alertWarn')).toContainText('Praxis anrufen: 02452 123456');
  });

  test('report omits the "Vereinbarte Grenzwerte" section entirely when no thresholds are configured', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30);
    const state = blankState({
      settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      days: { [start]: { g: 250 } }, // would be flagged if any threshold existed
    });
    await seed(page, state);
    const html = await page.evaluate(() => reportHTML());
    expect(html).not.toContain('Vereinbarte Grenzwerte');
  });

  test('report lists the correct flagged days when thresholds are configured, or says none crossed', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -10);
    const state = blankState({
      settings: { name: '', start, days: 30, carbGoal: 50, questions: '', lastBackup: null, meds: [], alerts: alerts({ gMax: 180 }) },
      days: {
        [addDays(start, 0)]: { g: 150 }, // inside
        [addDays(start, 1)]: { g: 220 }, // flagged
        [addDays(start, 2)]: { g: 190 }, // flagged
      },
    });
    await seed(page, state);
    const html = await page.evaluate(() => reportHTML());
    expect(html).toContain('Vereinbarte Grenzwerte');
    expect(html).toContain('Vereinbarte Grenzen: BZ');
    expect((html.match(/Blutzucker: \d+ mg\/dl/g) || []).length).toBe(2);
    expect(html).not.toContain('Keine Überschreitung im Zeitraum.');

    // Silent case: thresholds configured but nothing crosses them.
    const clean = blankState({
      settings: { name: '', start, days: 30, carbGoal: 50, questions: '', lastBackup: null, meds: [], alerts: alerts({ gMax: 180 }) },
      days: { [addDays(start, 0)]: { g: 150 } },
    });
    await seed(page, clean);
    const htmlClean = await page.evaluate(() => reportHTML());
    expect(htmlClean).toContain('Vereinbarte Grenzwerte');
    expect(htmlClean).toContain('Keine Überschreitung im Zeitraum.');
  });

  test('fridge sheet footer line is conditional, and the page still fits one A4 sheet at 6 medications with thresholds set', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-01-05'; // a Monday
    const meds = Array.from({ length: 6 }, (_, i) => ({ id: `med${i}`, name: `Testmed ${String.fromCharCode(65 + i)}`, dose: '10 mg', category: 'Medikament' }));

    // No thresholds: footer line absent.
    const plain = blankState({ settings: { name: 'Test Patient', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds } });
    for (let d = 0; d < 7; d++) {
      const ds = addDays(start, d);
      plain.days[ds] = { w: 82, g: 95, k: 0.8, sys1: 120, dia1: 80, sys2: 118, dia2: 78, c: 40, en: 3, hu: 3, plan: 'y', meds: {} };
    }
    await seed(page, plain);
    const plainHtml = await page.evaluate(() => sheetHTML(1, true));
    expect(plainHtml).not.toContain('Vereinbarte Grenzen');

    // Thresholds set: footer line present, and the sheet still fits one page.
    const withAlerts = blankState({
      settings: { name: 'Test Patient', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds,
        alerts: alerts({ sysMin: 100, sysMax: 160, diaMin: 60, diaMax: 100, gMin: 70, gMax: 180, action: 'Praxis anrufen: 02452 123456' }) },
    });
    for (let d = 0; d < 7; d++) {
      const ds = addDays(start, d);
      const medState = {};
      meds.forEach((m) => { medState[m.id] = d % 2 === 0; });
      withAlerts.days[ds] = { w: 82, g: 95, k: 0.8, sys1: 120, dia1: 80, sys2: 118, dia2: 78, c: 40, en: 3, hu: 3, plan: 'y', meds: medState };
    }
    withAlerts.weeks[1] = { waist: 90, rhr: 64, sleep: 7.2, stress: 27, steps: 8300, note: 'x' };
    await seed(page, withAlerts);

    const html = await page.evaluate(() => sheetHTML(1, true));
    expect(html).toContain('Vereinbarte Grenzen: RR sys 100–160, dia 60–100 · BZ 70–180 → Praxis anrufen: 02452 123456');

    const contentW = mmToPx(277), contentH = mmToPx(190);
    await page.setViewportSize({ width: Math.round(contentW), height: Math.round(contentH) + 400 });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate((w) => {
      document.getElementById('print').innerHTML = sheetHTML(1, true);
      document.querySelector('.sheet').style.width = w + 'px';
    }, contentW);
    await page.waitForTimeout(100);

    const sheetHeightPx = await page.locator('.sheet').evaluate((el) => el.getBoundingClientRect().height);
    expect(sheetHeightPx).toBeLessThanOrEqual(contentH);
  });

  test('VERSION in index.html and sw.js CACHE_NAME stay in sync after the bump', async ({ page }) => {
    await gotoApp(page);
    const version = await page.evaluate(() => VERSION);
    const swText = await page.evaluate(() => fetch('/sw.js').then((r) => r.text()));
    expect(swText).toContain(`keto-protokoll-v${version}`);
  });
});
