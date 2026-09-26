const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const titles = ['Gewicht', 'Blutzucker nüchtern', 'Ketone', 'Blutdruck', 'Kohlenhydrate',
  'Ruhepuls (Garmin, Wochenmittel)', 'Bauchumfang'];
const units = ['kg', 'mg/dl', 'mmol/l', 'mmHg', 'g/Tag', '/min', 'cm'];
const fixed = page => page.locator('#v-trend .fixed-charts figure.chart-fixed');

test.describe('Fixed chart readability', () => {
  test('shows seven titles, units, configured range, plotted counts and separate modeled-summary wording without saving', async ({ page }) => {
    const start = addDays(today(), -20), future = addDays(today(), 1);
    const state = blankState({ settings: { ...blankState().settings, start, days: 28 },
      days: { [start]: { w: 0, sys: 120, dia: 80 },
        [addDays(start, 14)]: { w: 82, sys: 122 }, [future]: { w: 81, dia: 78 } },
      weeks: { 1: { rhr: 60, waist: 90 } },
    });
    await gotoApp(page);
    await seed(page, state);
    const before = await page.evaluate(() => ({ live: JSON.stringify(S), key: localStorage.getItem(KEY),
      recovery: localStorage.getItem(RECOVERY_KEY) }));
    await page.locator('nav button[data-tab="trend"]').click();

    await expect(fixed(page)).toHaveCount(7);
    expect(await fixed(page).locator('.chart-title').allTextContents()).toEqual(titles);
    for (let i = 0; i < units.length; i++)
      await expect(fixed(page).nth(i).locator('figcaption > .sub')).toHaveText(`(${units[i]})`);
    const range = await page.evaluate(() => {
      const format = { day: '2-digit', month: '2-digit', year: 'numeric' };
      return `${fd(S.settings.start, format)} – ${fd(addDays(S.settings.start, N() - 1), format)}`;
    });
    await expect(page.locator('.fixed-charts')).toContainText(`Zeitraum: ${range}`);
    await expect(page.locator('.fixed-charts')).toContainText('Die Punkte zeigen gespeicherte Messwerte. Linien verbinden diese Werte.');
    await expect(page.locator('.fixed-charts')).toContainText('Der modellierte Trend wird separat in der Zusammenfassung oben berechnet.');
    await expect(page.locator('.fixed-charts')).toContainText('vorab eingetragene Werte');
    await expect(fixed(page).nth(0).locator('.chart-meta')).toContainText('3 dargestellte Werte');
    await expect(fixed(page).nth(0).locator('circle.s1d')).toHaveCount(3);
    await expect(fixed(page).nth(3).locator('.chart-meta')).toContainText('Systolisch: 2 · Diastolisch: 2');
    await expect(fixed(page).nth(3).locator('.chart-meta')).toContainText('abgeleitete Tageswerte');
    await expect(fixed(page).nth(5).locator('figcaption')).toContainText('Garmin, Wochenmittel');
    await expect(fixed(page).nth(6).locator('.chart-meta')).toContainText('Wochenwert');
    for (const panel of ['#experimentOverview', '#experimentSummary', '#historicalComparison', '#dataBasis'])
      await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator('#cmpA')).toHaveValue('c');
    await expect(page.locator('#cmpB')).toHaveValue('k');
    expect(await page.evaluate(() => ({ live: JSON.stringify(S), key: localStorage.getItem(KEY),
      recovery: localStorage.getItem(RECOVERY_KEY) }))).toEqual(before);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.7.4', schema: 6, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
  });

  test('screen presentation preserves observation and goal geometry, BP values, and non-color series distinction', async ({ page }) => {
    const start = addDays(today(), -14), change = addDays(start, 7);
    await gotoApp(page);
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 28,
      carbGoal: 30, carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }] },
      days: { [start]: { w: 0, k: 1, c: 0, sys1: 120, dia1: 80, sys2: 130, dia2: 84 },
        [change]: { w: 80, k: 1.5, c: 40, sys1: 122, dia1: 78 } },
    }));
    await page.locator('nav button[data-tab="trend"]').click();
    const geometry = await page.evaluate(() => {
      const parse = html => new DOMParser().parseFromString(html, 'text/html');
      const paths = doc => [...doc.querySelectorAll('svg path')].map(el => el.getAttribute('d'));
      const circles = doc => [...doc.querySelectorAll('svg circle')].map(el =>
        [el.getAttribute('cx'), el.getAttribute('cy'), el.getAttribute('r')]);
      return [0, 3, 4].map(i => {
        const old = parse(chartSet()[i]);
        const shown = document.querySelectorAll('#v-trend .fixed-charts figure')[i];
        return { oldPaths: paths(old), shownPaths: paths(shown), oldPoints: circles(old), shownPoints: circles(shown) };
      });
    });
    for (const chart of geometry) {
      expect(chart.shownPaths).toEqual(chart.oldPaths);
      expect(chart.shownPoints).toEqual(chart.oldPoints);
    }
    expect(geometry[0].shownPoints[0][0]).toBe('44.0');
    expect(geometry[0].shownPoints[1][0]).toBe((44 + 7 / 27 * 546).toFixed(1));
    expect(await page.evaluate(() => ({ weight: ser('w'), systolic: ser('sys'), diastolic: ser('dia'), carbs: ser('c') })))
      .toEqual({ weight: [[0, 0], [7, 80]], systolic: [[0, 125], [7, 122]],
        diastolic: [[0, 82], [7, 78]], carbs: [[0, 0], [7, 40]] });
    const bp = fixed(page).nth(3);
    await expect(bp.locator('path.bp-diastolic')).toHaveCount(1);
    await expect(bp).toContainText('diastolisch (gestrichelt)');
    expect(await bp.locator('path.bp-diastolic').evaluate(el => getComputedStyle(el).strokeDasharray)).not.toBe('none');
    await expect(fixed(page).nth(4).locator('path.goal')).toHaveCount(1);
    expect(await fixed(page).nth(4).locator('path.goal').getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+$/);
    await expect(fixed(page).nth(2).locator('rect.band')).toHaveCount(1);
    await expect(fixed(page).nth(2)).toContainText('0,5–3,0 mmol/l');
    await expect(fixed(page).nth(0).locator('path.s1')).toHaveCount(1);
    await expect(fixed(page).nth(3).locator('path.s1, path.s2')).toHaveCount(2);
  });

  test('empty, goal-only, and sparse charts state exactly what is drawn with accessible SVG descriptions', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(fixed(page).nth(0)).toContainText('Noch keine Messwerte.');
    await expect(fixed(page).nth(0).locator('svg')).toHaveCount(0);
    await expect(fixed(page).nth(4)).toContainText('Noch keine Messwerte. Der hinterlegte Zielverlauf wird angezeigt.');
    await expect(fixed(page).nth(4).locator('path.goal')).toHaveCount(1);
    await expect(fixed(page).nth(4).locator('circle')).toHaveCount(0);
    await expect(fixed(page).nth(4).locator('.chart-meta')).toContainText('0 dargestellte Werte');
    const start = addDays(today(), -8);
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 21 },
      days: { [start]: { w: 0, c: 0 }, [addDays(start, 7)]: { g: 95 } } }));
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(fixed(page).nth(0).locator('circle')).toHaveCount(1);
    await expect(fixed(page).nth(0).locator('.chart-meta')).toContainText('1 dargestellter Wert');
    await expect(fixed(page).nth(1).locator('circle')).toHaveCount(1);
    await expect(fixed(page).nth(0).locator('path.s1')).toHaveCount(1);
    expect(await fixed(page).nth(0).locator('path.s1').getAttribute('d')).not.toContain('L');
    await expect(page.locator('#experimentSummary .summary-row')).toHaveCount(0);
    const weight = fixed(page).nth(0).locator('svg');
    await expect(weight.locator('title')).toHaveText('Gewicht');
    await expect(weight.locator('desc')).toContainText('Einheit kg. 1 dargestellter Wert. Zeitraum');
    await expect(weight).toHaveAttribute('aria-label', /Gewicht\. Einheit kg\. 1 dargestellter Wert\. Zeitraum/);
    await expect(fixed(page).nth(4).locator('svg desc')).toContainText('gestrichelte Stufenlinie');
    await expect(fixed(page).nth(3).locator('svg')).toHaveCount(0);
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 21 },
      days: { [start]: { w: 0 }, [addDays(start, 7)]: { w: 80 } } }));
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(fixed(page).nth(0).locator('circle')).toHaveCount(2);
    await expect(fixed(page).nth(0).locator('.chart-meta')).toContainText('2 dargestellte Werte');
    await expect(page.locator('#experimentSummary .summary-row')).toHaveCount(0);
  });
});
