const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const withPeriod = (start, length, overrides = {}) => blankState({
  ...overrides, settings: { ...blankState().settings, ...overrides.settings, start, days: length },
});
const row = (page, id) => page.locator(`#experimentSummary [data-summary="${id}"]`);

async function openSummary(page, state) {
  await gotoApp(page);
  await seed(page, state);
  await page.locator('nav button[data-tab="trend"]').click();
}

test.describe('Experiment summary in Verlauf', () => {
  test('pre-start period shows a neutral message and no metric rows', async ({ page }) => {
    const start = addDays(today(), 2);
    await openSummary(page, withPeriod(start, 28, {
      days: { [start]: { w: 80 } }, weeks: { 1: { waist: 90 }, 2: { waist: 88 }, 3: { waist: 86 } },
    }));
    await expect(page.locator('#experimentSummary')).toContainText('Der Durchgang hat noch nicht begonnen.');
    await expect(page.locator('#experimentSummary .summary-row')).toHaveCount(0);
  });

  test('fewer than three usable weeks gives the insufficient-data state', async ({ page }) => {
    const start = addDays(today(), -13);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 },
    } }));
    await expect(page.locator('#experimentSummary')).toContainText('noch nicht genügend Wochen mit Daten');
    await expect(page.locator('#experimentSummary .summary-row')).toHaveCount(0);
  });

  test('three weight weeks use fitted endpoints and a neutral signed negative delta', async ({ page }) => {
    const start = addDays(today(), -20);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 }, [addDays(start, 14)]: { w: 79 },
    } }));
    const weight = row(page, 'w');
    await expect(weight).toContainText('81,8 → 78,8 kg · Δ −3 kg');
    await expect(weight).toContainText('Datenbasis: 3 Werte · 3 Wochen');
    const fitted = await page.evaluate(() => {
      const result = experimentSummary(S).rows.find(item => item.id === 'w');
      const fit = trendFit([[1, 82], [2, 80], [3, 79]]);
      return { result, expectedStart: fit.a + fit.b, expectedEnd: fit.a + fit.b * 3 };
    });
    expect(fitted.result.start).toBeCloseTo(fitted.expectedStart, 10);
    expect(fitted.result.end).toBeCloseTo(fitted.expectedEnd, 10);
    expect(fitted.result.delta).toBeCloseTo(-3, 10);
  });

  test('positive and zero deltas use + and ± while zero daily values count', async ({ page }) => {
    const start = addDays(today(), -20);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { g: 0, k: 1 }, [addDays(start, 7)]: { g: 10, k: 1 },
      [addDays(start, 14)]: { g: 20, k: 1 },
    } }));
    await expect(row(page, 'g')).toContainText('0 → 20 mg/dl · Δ +20 mg/dl');
    await expect(row(page, 'g')).toContainText('Datenbasis: 3 Werte · 3 Wochen');
    await expect(row(page, 'k')).toContainText('Δ ±0 mmol/l');
  });

  test('daily samples count finite days and a started partial week contributes', async ({ page }) => {
    const start = addDays(today(), -15);
    const schedule = Object.fromEntries(['w','g','k','bp','p'].map(id => [id, { mode: 'optional', weekdays: [] }]));
    await openSummary(page, withPeriod(start, 28, { settings: { measurementSchedule: schedule }, days: {
      [start]: { w: 82 }, [addDays(start, 1)]: { w: 80 }, [addDays(start, 7)]: { w: 79 },
      [addDays(start, 14)]: { w: 0 }, [addDays(start, 15)]: { w: 'invalid' },
    } }));
    await expect(row(page, 'w')).toContainText('Datenbasis: 4 Werte · 3 Wochen');
    expect(await page.evaluate(() => experimentSummary(S).rows.find(item => item.id === 'w').weeks)).toBe(3);
    await expect(page.locator('#experimentSummary')).toContainText('Auch eine laufende Woche kann berücksichtigt werden');
    await expect(page.locator('#experimentSummary')).not.toContainText('%');
  });

  test('weekly metrics use finite stored values including zero', async ({ page }) => {
    const start = addDays(today(), -20);
    await openSummary(page, withPeriod(start, 28, { weeks: {
      1: { waist: 90, sleep: 0 }, 2: { waist: 88, sleep: 4 }, 3: { waist: 86, sleep: 8 },
    } }));
    await expect(row(page, 'waist')).toContainText('90 → 86 cm · Δ −4 cm');
    await expect(row(page, 'sleep')).toContainText('Datenbasis: 3 Werte · 3 Wochen');
    await expect(row(page, 'sleep')).toContainText('0 → 8 h · Δ +8 h');
  });

  test('pre-entered future days and weeks cannot create trend rows', async ({ page }) => {
    const start = addDays(today(), -13);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 },
      [addDays(start, 14)]: { w: 78 },
    }, weeks: { 1: { waist: 90 }, 2: { waist: 88 }, 3: { waist: 86 } } }));
    await expect(page.locator('#experimentSummary .summary-row')).toHaveCount(0);
    expect(await page.evaluate(() => experimentSummary(S).rows)).toEqual([]);
  });

  test('systolic and diastolic trends use derived BP values including migrated history', async ({ page }) => {
    const start = addDays(today(), -20);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { sys: 130, dia: 82 },
      [addDays(start, 7)]: { sys1: 126, dia1: 80, sys2: 124, dia2: 78 },
      [addDays(start, 14)]: { sys: 120, dia: 76 },
    } }));
    await expect(row(page, 'sys')).toContainText('Datenbasis: 3 Werte · 3 Wochen');
    await expect(row(page, 'dia')).toContainText('Datenbasis: 3 Werte · 3 Wochen');
    expect(await page.evaluate(() => ({ first: S.days[S.settings.start],
      second: S.days[addDays(S.settings.start, 7)] }))).toMatchObject({
      first: { sys: 130, dia: 82, sys1: 130, dia1: 82 },
      second: { sys: 125, dia: 79 },
    });
    await expect(row(page, 'sys')).toContainText('130 → 120 mmHg');
    await expect(row(page, 'dia')).toContainText('82 → 76 mmHg');
  });

  test('all fourteen supported metrics render in the defined order when data exists', async ({ page }) => {
    const start = addDays(today(), -20);
    const days = {}, weeks = {};
    for (let i = 0; i < 3; i++) {
      days[addDays(start, i * 7)] = { w: 80-i, g: 90+i, k: 1+i/10, sys: 130-i, dia: 80-i,
        p: 70+i, c: 30+i, en: 3, hu: 2 };
      weeks[i+1] = { waist: 90-i, rhr: 60+i, sleep: 7, stress: 30+i, steps: 5000+i*100 };
    }
    await openSummary(page, withPeriod(start, 28, { days, weeks }));
    expect(await page.locator('#experimentSummary .summary-row').evaluateAll(nodes => nodes.map(node => node.dataset.summary)))
      .toEqual(['w','g','k','sys','dia','p','c','en','hu','waist','rhr','sleep','stress','steps']);
  });

  test('sparse metrics stay absent and explanation stays descriptive', async ({ page }) => {
    const start = addDays(today(), -20);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { w: 82, g: 90 }, [addDays(start, 7)]: { w: 80 },
      [addDays(start, 14)]: { w: 79 },
    } }));
    await expect(row(page, 'w')).toBeVisible();
    await expect(row(page, 'g')).toHaveCount(0);
    const text = await page.locator('#experimentSummary').innerText();
    expect(text).toContain('modellierte Werte aus dem linearen Trend');
    expect(text).toContain('keine einzelnen ersten oder letzten Messungen');
    expect(text).toContain('weder statistische Signifikanz noch Ursachen');
    expect(text).not.toMatch(/verbessert|verschlechtert|besser|schlechter|gesund|ungesund|positiv|negativ|günstig|ungünstig|erfolgreich|problematisch/i);
    expect(text).not.toContain('signifikant');
  });

  test('live summary never calls or renders report talking points', async ({ page }) => {
    const start = addDays(today(), -20);
    await gotoApp(page);
    await seed(page, withPeriod(start, 28, { days: {
      [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 }, [addDays(start, 14)]: { w: 79 },
    } }));
    await page.evaluate(() => { window.__originalTalkingPoints = generateTalkingPoints;
      generateTalkingPoints = () => { throw new Error('Synthetic talking-point call'); }; });
    try {
      await page.locator('nav button[data-tab="trend"]').click();
      await expect(row(page, 'w')).toBeVisible();
      await expect(page.locator('#experimentSummary')).not.toContainText('Synthetic talking-point call');
    } finally {
      await page.evaluate(() => { generateTalkingPoints = window.__originalTalkingPoints;
        delete window.__originalTalkingPoints; });
    }
  });

  test('summary precedes data basis and charts while comparison stays usable', async ({ page }) => {
    const start = addDays(today(), -20);
    await openSummary(page, withPeriod(start, 28, { days: {
      [start]: { c: 30, k: 1 }, [addDays(start, 7)]: { c: 40, k: 1.1 },
      [addDays(start, 14)]: { c: 50, k: 1.2 },
    } }));
    const children = await page.locator('#v-trend > *').evaluateAll(nodes => nodes.map(node => node.id || node.querySelector('h2')?.textContent));
    expect(children.slice(0,4)).toEqual(['experimentOverview','experimentSummary','historicalComparison','dataBasis']);
    expect(children.at(-1)).toBe('Vergleich zweier Werte');
    const captions = await page.locator('#v-trend .chart figcaption').allTextContents();
    for (const label of ['Gewicht','Blutzucker nüchtern','Ketone','Blutdruck','Kohlenhydrate',
      'Ruhepuls (Garmin, Wochenmittel)','Bauchumfang']) expect(captions.some(text => text.includes(label))).toBe(true);
    await expect(page.locator('#cmpA')).toHaveValue('c');
    await expect(page.locator('#cmpB')).toHaveValue('k');
    await page.locator('#cmpA').selectOption('w');
    await expect(page.locator('#cmpChart')).toContainText('Gewicht');
  });

  test('opening Verlauf leaves live state, backup metadata and both storage keys unchanged', async ({ page }) => {
    const start = addDays(today(), -20);
    await gotoApp(page);
    await seed(page, withPeriod(start, 28, { days: {
      [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 }, [addDays(start, 14)]: { w: 79 },
    } }));
    const before = await page.evaluate(() => ({ live: JSON.stringify(S), key: localStorage.getItem(KEY),
      recovery: localStorage.getItem(RECOVERY_KEY), lastBackup: S.settings.lastBackup }));
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(row(page, 'w')).toBeVisible();
    expect(await page.evaluate(() => ({ live: JSON.stringify(S), key: localStorage.getItem(KEY),
      recovery: localStorage.getItem(RECOVERY_KEY), lastBackup: S.settings.lastBackup }))).toEqual(before);
  });

  test('release version and unchanged schema and keys are exposed', async ({ page }) => {
    await gotoApp(page);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.8.0', schema: 7, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
  });
});
