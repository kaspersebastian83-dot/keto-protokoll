const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

async function openOverview(page, state) {
  await gotoApp(page);
  await seed(page, state);
  await page.locator('nav button[data-tab="trend"]').click();
}
const stateWithPeriod = (start, days, overrides = {}) => blankState({
  ...overrides, settings: { ...blankState().settings, ...overrides.settings, start, days },
});
const quality = (page, id) => page.locator(`#dataBasis [data-quality="${id}"]`);

test.describe('Experiment overview and data basis', () => {
  test('active period counts elapsed days and each day with any entry once, excluding future entries', async ({ page }) => {
    const start = addDays(today(), -4);
    const days = {
      [start]: { w: 82 },
      [addDays(start, 1)]: { note: 'Synthetic note' },
      [addDays(start, 2)]: { w: 81, g: 90, meds: { synthetic: true } },
      [addDays(start, 7)]: { w: 79 },
    };
    await openOverview(page, stateWithPeriod(start, 14, { days }));
    await expect(page.locator('#experimentOverview')).toContainText('Tag 5 von 14');
    await expect(page.locator('#experimentOverview')).toContainText('3 von 5 vergangenen Tagen');
    await expect(page.locator('#experimentOverview')).toContainText('Noch kein Wochen-Check-in fällig.');
    await expect(quality(page, 'w')).toContainText('2 Werte · 1 Woche mit Daten');
  });

  test('medication-only day is one logged day', async ({ page }) => {
    const start = addDays(today(), -1);
    await openOverview(page, stateWithPeriod(start, 7, { days: { [start]: { meds: { synthetic: false } } } }));
    await expect(page.locator('#experimentOverview')).toContainText('1 von 2 vergangenen Tagen');
  });

  test('pre-start period has a neutral empty state even with pre-entered data', async ({ page }) => {
    const start = addDays(today(), 2);
    await openOverview(page, stateWithPeriod(start, 14, { days: { [start]: { w: 82 } },
      weeks: { 1: { waist: 84 } } }));
    await expect(page.locator('#experimentOverview')).toContainText('Beginnt am');
    await expect(page.locator('#experimentOverview')).toContainText('Noch keine vergangenen Tage.');
    await expect(page.locator('#experimentOverview')).toContainText('Noch kein Wochen-Check-in fällig.');
    await expect(quality(page, 'w')).toContainText('0 Werte · 0 Wochen mit Daten');
    await expect(quality(page, 'waist')).toContainText('0 Werte · 0 Wochen mit Daten');
  });

  test('finished period uses its full length and configured date range', async ({ page }) => {
    const start = addDays(today(), -12),end = addDays(start, 9);
    await openOverview(page, stateWithPeriod(start, 10, { days: { [end]: { note: 'Synthetic end note' } } }));
    await expect(page.locator('#experimentOverview')).toContainText('Zeitraum abgeschlossen · 10 Tage');
    await expect(page.locator('#experimentOverview')).toContainText('1 von 10 vergangenen Tagen');
    const dates = await page.evaluate(() => [fd(S.settings.start,{day:'numeric',month:'long',year:'numeric'}),
      fd(addDays(S.settings.start,N()-1),{day:'numeric',month:'long',year:'numeric'})]);
    await expect(page.locator('#experimentOverview')).toContainText(`${dates[0]} bis ${dates[1]}`);
  });

  test('weekly due dates follow normal and partial final week ends', async ({ page }) => {
    const start = '2026-01-01';
    await gotoApp(page);
    await seed(page, stateWithPeriod(start, 14));
    expect(await page.evaluate(() => [5, 7, 13, 14].map(day => experimentOverview(S,addDays(S.settings.start,day-1)).dueWeeks)))
      .toEqual([0, 1, 1, 2]);
    await seed(page, stateWithPeriod(start, 10));
    expect(await page.evaluate(() => [5, 7, 9, 10].map(day => experimentOverview(S,addDays(S.settings.start,day-1)).dueWeeks)))
      .toEqual([0, 1, 1, 2]);
  });

  test('weekly completion requires all five fields and accepts zero while notes remain optional', async ({ page }) => {
    const start = addDays(today(), -9);
    await openOverview(page, stateWithPeriod(start, 10, { weeks: {
      1: { waist: 84, rhr: 60, sleep: 7, stress: 35, note: 'Synthetic note' },
      2: { waist: 83, rhr: 61, sleep: 7, stress: 34, steps: 0 },
    } }));
    await expect(page.locator('#experimentOverview')).toContainText('1 von 2 fälligen vollständig');
    expect(await page.evaluate(() => [weeklyCheckinComplete(1),weeklyCheckinComplete(2)])).toEqual([false,true]);
  });

  test('labor counts entered baseline and end values without percentages', async ({ page }) => {
    await openOverview(page, stateWithPeriod(today(), 14, { labs: [
      { name: 'Synthetic A', base: '0', end: '' },
      { name: 'Synthetic B', base: '  ', end: '5' },
      { name: 'Synthetic C', base: '4', end: '3' },
    ] }));
    await expect(page.locator('#experimentOverview')).toContainText('2 Basiswerte · 2 Abschlusswerte');
    await expect(page.locator('#experimentOverview')).not.toContainText('%');
  });

  test('daily zero values and distinct weeks count without current schedule percentages', async ({ page }) => {
    const start = addDays(today(), -20);
    const days = { [start]: { w: 0, c: 0, en: 0, hu: 0 },
      [addDays(start, 2)]: { w: 80 }, [addDays(start, 14)]: { w: 79 },
      [addDays(start, 24)]: { w: 78 } };
    const measurementSchedule = Object.fromEntries(['w','g','k','bp','p'].map(id => [id,{ mode:'optional', weekdays:[] }]));
    await openOverview(page, stateWithPeriod(start, 28, { days,
      settings: { measurementSchedule } }));
    await expect(quality(page, 'w')).toContainText('3 Werte · 2 Wochen mit Daten');
    for (const id of ['c','en','hu']) await expect(quality(page,id)).toContainText('1 Wert · 1 Woche mit Daten');
    await expect(page.locator('#dataBasis')).not.toContainText('%');
  });

  test('BP counts legacy and partial days but only full two-reading days meet the protocol', async ({ page }) => {
    const start = addDays(today(), -13);
    await openOverview(page, stateWithPeriod(start, 14, { days: {
      [start]: { sys: 128, dia: 82 },
      [addDays(start, 7)]: { sys1: 130, dia1: 80, sys2: 126, dia2: 78 },
      [addDays(start, 8)]: { sys1: 125 },
    } }));
    const bp = quality(page, 'bp');
    await expect(bp).toContainText('3 Werte · 2 Wochen mit Daten');
    await expect(bp).toContainText('2 Messungen vollständig: 1 von 3 Blutdrucktagen');
    expect(await page.evaluate(() => S.days[S.settings.start].sys1)).toBe(128);
  });

  test('trend readiness follows trendFit with three usable daily or weekly points', async ({ page }) => {
    const start = addDays(today(), -20);
    const days = { [start]: { w: 80, g: 90 }, [addDays(start, 7)]: { w: 79, g: 91 },
      [addDays(start, 14)]: { w: 78 } };
    const weeks = { 1: { waist: 84, sleep: 7 }, 2: { waist: 83, sleep: 6 }, 3: { waist: 82 } };
    await openOverview(page, stateWithPeriod(start, 28, { days, weeks }));
    await expect(quality(page,'w')).toContainText('Trendberechnung möglich');
    await expect(quality(page,'g')).toContainText('Trendberechnung noch nicht möglich');
    await expect(quality(page,'waist')).toContainText('Trendberechnung möglich');
    await expect(quality(page,'sleep')).toContainText('Trendberechnung noch nicht möglich');
    await expect(page.locator('#dataBasis')).toContainText('mindestens drei Wochen');
  });

  test('future weeks and future daily values do not inflate an ongoing overview', async ({ page }) => {
    const start = addDays(today(), -4);
    await openOverview(page, stateWithPeriod(start, 28, { days: {
      [start]: { w: 80 }, [addDays(start, 14)]: { w: 78 },
    }, weeks: { 1: { waist: 84 }, 2: { waist: 83 }, 4: { waist: 81 } } }));
    await expect(quality(page,'w')).toContainText('1 Wert · 1 Woche mit Daten');
    await expect(quality(page,'waist')).toContainText('1 Wert · 1 Woche mit Daten');
    await expect(quality(page,'waist')).toContainText('Trendberechnung noch nicht möglich');
  });

  test('existing charts and two-variable comparison remain below the overview and work', async ({ page }) => {
    const start = addDays(today(), -6);
    await openOverview(page, stateWithPeriod(start, 14, { days: {
      [start]: { c: 30, k: 1.2 }, [addDays(start, 1)]: { c: 50, k: 0.8 },
    } }));
    const captions = await page.locator('#v-trend .chart figcaption').allTextContents();
    for (const label of ['Gewicht','Blutzucker nüchtern','Ketone','Blutdruck','Kohlenhydrate',
      'Ruhepuls (Garmin, Wochenmittel)','Bauchumfang']) expect(captions.some(text => text.includes(label))).toBe(true);
    await expect(page.locator('#cmpA')).toHaveValue('c');
    await expect(page.locator('#cmpB')).toHaveValue('k');
    await expect(page.locator('#cmpChart svg path')).toHaveCount(2);
    await page.locator('#cmpA').selectOption('w');
    await expect(page.locator('#cmpChart')).toContainText('Für diese Kombination liegen noch keine gemeinsamen Werte vor.');
    const sectionOrder = await page.locator('#v-trend > *').evaluateAll(nodes => nodes.map(node => node.id||node.querySelector('h2')?.textContent||''));
    expect(sectionOrder[0]).toBe('experimentOverview');
    expect(sectionOrder[1]).toBe('experimentSummary');
    expect(sectionOrder[2]).toBe('historicalComparison');
    expect(sectionOrder[3]).toBe('dataBasis');
    expect(sectionOrder.at(-1)).toBe('Vergleich zweier Werte');
  });

  test('opening Verlauf leaves live state and local storage byte-for-byte unchanged', async ({ page }) => {
    const start = addDays(today(), -7);
    await gotoApp(page);
    await seed(page, stateWithPeriod(start, 14, { days: { [start]: { w: 80 } },
      weeks: { 1: { waist: 84 } } }));
    const before = await page.evaluate(() => ({ live: JSON.stringify(S), stored: localStorage.getItem(KEY),
      recovery: localStorage.getItem(RECOVERY_KEY) }));
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(page.locator('#experimentOverview')).toBeVisible();
    expect(await page.evaluate(() => ({ live: JSON.stringify(S), stored: localStorage.getItem(KEY),
      recovery: localStorage.getItem(RECOVERY_KEY) }))).toEqual(before);
  });

  test('release and storage metadata remain synchronized at version 1.7.2', async ({ page }) => {
    await gotoApp(page);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.7.2', schema: 6, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
  });
});
