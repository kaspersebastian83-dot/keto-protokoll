const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const period = (start, days = {}, weeks = {}) => blankState({
  settings: { ...blankState().settings, start, days: 28 }, days, weeks,
});
const entries = (start, field, values) => Object.fromEntries(values.map((value, i) =>
  [addDays(start, i * 7), { [field]: value }]));
const archive = (data, label = 'Synthetic earlier period', archivedAt = addDays(data.settings.start, 20)) =>
  ({ label, archivedAt, data });
const metric = (page, id) => page.locator(`#historicalComparison [data-compare="${id}"]`);

async function open(page, live) {
  await gotoApp(page);
  await seed(page, live);
  await page.locator('nav button[data-tab="trend"]').click();
}

test.describe('Historical comparison visualization', () => {
  test('uses the existing 14 metric order and keeps all Verlauf content', async ({ page }) => {
    const start = addDays(today(), -20), days = {}, weeks = {};
    for (let i = 0; i < 3; i++) {
      days[addDays(start, i * 7)] = { w: 80 + i, g: 90 + i, k: 1 + i / 10,
        sys: 120 + i, dia: 80 + i, p: 70 + i, c: 30 + i, en: 3 + i / 10, hu: 2 + i / 10 };
      weeks[i + 1] = { waist: 90 + i, rhr: 60 + i, sleep: 7 + i / 10,
        stress: 30 + i, steps: 5000 + i * 100 };
    }
    const live = period(start, days, weeks);
    live.archive = [archive(period(start, days, weeks))];
    await open(page, live);
    expect(await page.locator('.period-compare-row').evaluateAll(nodes => nodes.map(n => n.dataset.compare)))
      .toEqual(['w', 'g', 'k', 'sys', 'dia', 'p', 'c', 'en', 'hu', 'waist', 'rhr', 'sleep', 'stress', 'steps']);
    await expect(page.locator('.comparison-value-track')).toHaveCount(28);
    for (const id of ['experimentOverview', 'experimentSummary', 'dataBasis'])
      await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('#v-trend .chart')).toHaveCount(8); // seven fixed charts plus comparison chart
    await expect(page.locator('#cmpA')).toBeVisible();
    await expect(page.locator('#cmpB')).toBeVisible();
  });

  test('tracks map the existing modeled endpoints rather than raw first and last observations', async ({ page }) => {
    const liveStart = addDays(today(), -20), oldStart = addDays(today(), -50);
    const live = period(liveStart, entries(liveStart, 'w', [82, 80, 79]));
    live.archive = [archive(period(oldStart, entries(oldStart, 'w', [84, 82, 81])))];
    await open(page, live);
    const expected = await page.evaluate(() => {
      const row = experimentPeriodComparison(S, S.archive[0]).rows.find(r => r.id === 'w');
      const scale = comparisonVisualScale([row.current.start, row.current.end, row.archived.start, row.archived.end], 1);
      return { current: [comparisonVisualPosition(row.current.start, scale), comparisonVisualPosition(row.current.end, scale)],
        archive: [comparisonVisualPosition(row.archived.start, scale), comparisonVisualPosition(row.archived.end, scale)] };
    });
    for (const [side, modeled] of [['current', expected.current], ['archive', expected.archive]]) {
      const track = metric(page, 'w').locator(`svg.${side}`);
      const actual = await track.locator('.track-connector').evaluate(node =>
        [Number(node.getAttribute('x1')), Number(node.getAttribute('x2'))]);
      expect(actual[0]).toBeCloseTo(modeled[0], 8);
      expect(actual[1]).toBeCloseTo(modeled[1], 8);
    }
    await expect(metric(page, 'w').locator('.period-side-current')).toContainText('81,8 → 78,8 kg · Δ −3 kg');
    await expect(metric(page, 'w').locator('.period-side-archive')).toContainText('83,8 → 80,8 kg · Δ −3 kg');
    await expect(metric(page, 'w').locator('.period-side-current')).not.toContainText('82 → 79 kg');
    await expect(metric(page, 'w').locator('.period-side-archive')).not.toContainText('84 → 81 kg');
    await expect(metric(page, 'w')).toContainText('3 Werte · 3 Wochen');
    await expect(page.locator('#historicalComparisonContent')).toContainText('Die Strecke ist keine Zeitachse');
    await expect(page.locator('#historicalComparisonContent')).toContainText('Die Zeiträume können unterschiedlich lang sein');
  });

  test('scale is metric-local, padded, and handles zero, negatives, identical values, and large steps', async ({ page }) => {
    await open(page, period(addDays(today(), -20)));
    const geometry = await page.evaluate(() => {
      const scale = values => comparisonVisualScale(values, 1);
      const x = (value, bounds) => comparisonVisualPosition(value, bounds);
      const small = scale([80, 80.01, 80.02]);
      const negative = scale([-5, -4, -3]);
      const identical = scale([7, 7]);
      const steps = comparisonVisualScale([100000, 100100, 100200], 0);
      const other = scale([1, 2]);
      return { small, smallMovement: x(80.02, small) - x(80, small),
        negative: [-5, -4, -3].map(v => x(v, negative)), identical: x(7, identical),
        steps: [100000, 100100, 100200].map(v => x(v, steps)),
        other, empty: comparisonVisualScale([null, undefined, NaN], 1) };
    });
    expect(geometry.small.min).toBeGreaterThan(0); // no forced zero baseline
    expect(geometry.smallMovement).toBeGreaterThan(0);
    expect(geometry.smallMovement).toBeLessThan(100); // tiny movement does not fill track
    expect(geometry.negative[0]).toBeLessThan(geometry.negative[1]);
    expect(geometry.negative[1]).toBeLessThan(geometry.negative[2]);
    expect(geometry.identical).toBeCloseTo(150, 8);
    for (const x of geometry.steps) expect(x).toBeGreaterThanOrEqual(14);
    for (const x of geometry.steps) expect(x).toBeLessThanOrEqual(286);
    expect(geometry.other.normalizer).not.toBe(geometry.small.normalizer); // distinct metric scales
    expect(geometry.empty).toBeNull();
  });

  test('extreme finite endpoints produce only finite in-bounds SVG coordinates', async ({ page }) => {
    await open(page, period(addDays(today(), -20)));
    const result = await page.evaluate(() => {
      const current = { start: -5e307, end: -5e307, delta: 0, digits: 0, unit: 'Schritte', count: 3, weeks: 3 };
      const archived = { start: 1.3e308, end: 1.3e308, delta: 0, digits: 0, unit: 'Schritte', count: 3, weeks: 3 };
      const visual = historicalComparisonVisualHTML({ current, archived });
      const html = comparisonSideHTML(current, 'Aktueller Durchgang', 'current', visual.current) +
        comparisonSideHTML(archived, 'Früherer Durchgang', 'archive', visual.archived);
      const container = document.createElement('div');
      container.innerHTML = html;
      const coordinates = [...container.querySelectorAll('svg *')].flatMap(node =>
        ['x', 'x1', 'x2', 'cx', 'cy', 'y', 'y1', 'y2', 'r', 'width', 'height']
          .filter(attr => node.hasAttribute(attr)).map(attr => Number(node.getAttribute(attr))));
      const oneSided = historicalComparisonVisualHTML({ current: { start: -5e307, end: 1.3e308, digits: 0 }, archived: null }).current;
      return { html, visual, coordinates, oneSided,
        scale: comparisonVisualScale([-5e307, 1.3e308], 0),
        invalid: [comparisonVisualPosition(Infinity, comparisonVisualScale([1, 2], 0)),
          comparisonVisualPosition(1, { normalizer: 1, min: 2, max: 2 }),
          comparisonVisualPosition(1e308, { normalizer: 1, min: 0, max: 1 }),
          comparisonVisualPosition(1, { normalizer: 1, min: -1e308, max: 1e308 }),
          comparisonVisualPosition(1, { normalizer: 1, min: 0, max: Number.MIN_VALUE })],
        noTrack: historicalComparisonVisualHTML({ current: { start: Infinity, end: 1, digits: 0 }, archived: null }).current };
    });
    expect(result.scale.normalizer).toBe(1.3e308);
    expect(Number.isFinite(result.scale.min)).toBe(true);
    expect(Number.isFinite(result.scale.max)).toBe(true);
    expect(result.scale.max).toBeGreaterThan(result.scale.min);
    expect(result.visual.current).toContain('<circle');
    expect(result.visual.archived).toContain('<rect');
    expect(result.oneSided).toContain('<svg');
    expect(result.coordinates.every(Number.isFinite)).toBe(true);
    expect(result.coordinates.filter(x => x > 10).every(x => x <= 286)).toBe(true);
    expect(result.html).toContain('Aktueller Durchgang');
    expect(result.html).toContain('Früherer Durchgang');
    expect(result.html).toContain('Δ ±0 Schritte');
    expect(result.visual.current + result.visual.archived + result.oneSided).not.toMatch(/NaN|Infinity|-Infinity/);
    expect(result.invalid).toEqual([null, null, null, null, null]);
    expect(result.noTrack).toBe('');
  });

  test('tiny modeled changes keep exact x positions and distinct endpoint roles', async ({ page }) => {
    await open(page, period(addDays(today(), -20)));
    const cases = await page.evaluate(() => [[100, 100.01, 2], [80, 80.1, 1], [5000, 5001, 0]].map(([start, end, digits]) => {
      const row = { start, end, delta: end - start, digits, unit: '', count: 3, weeks: 3 };
      const visual = historicalComparisonVisualHTML({ current: row, archived: row });
      const element = document.createElement('div');
      element.innerHTML = comparisonSideHTML(row, 'Aktueller Durchgang', 'current', visual.current) +
        comparisonSideHTML(row, 'Früherer Durchgang', 'archive', visual.archived);
      const current = element.querySelector('svg.current'), archived = element.querySelector('svg.archive');
      const circleStart = current.querySelector('.track-start'),circleEnd = current.querySelector('.track-end');
      const squareStart = archived.querySelector('.track-start'),squareEnd = archived.querySelector('.track-end');
      return { start, end, digits, text: element.textContent,
        positions: [Number(circleStart.getAttribute('cx')), Number(circleEnd.getAttribute('cx'))],
        currentLine: [Number(current.querySelector('.track-connector').getAttribute('x1')),
          Number(current.querySelector('.track-connector').getAttribute('x2'))],
        archiveLine: [Number(archived.querySelector('.track-connector').getAttribute('x1')),
          Number(archived.querySelector('.track-connector').getAttribute('x2'))],
        markers: [Number(circleStart.getAttribute('r')), Number(circleEnd.getAttribute('r')),
          Number(squareStart.getAttribute('width')), Number(squareEnd.getAttribute('width'))],
        formatted: `${fmt(start,digits)} → ${fmt(end,digits)}` };
    }));
    for (const item of cases) {
      expect(item.positions.every(Number.isFinite)).toBe(true);
      expect(item.positions[1]).toBeGreaterThan(item.positions[0]);
      expect(item.positions[1] - item.positions[0]).toBeLessThan(4); // no artificial minimum displacement
      expect(item.currentLine).toEqual(item.positions);
      expect(item.archiveLine).toEqual(item.positions);
      expect(item.markers[0]).toBeGreaterThan(item.markers[1]);
      expect(item.markers[2]).toBeGreaterThan(item.markers[3]);
      expect(item.text).toContain(item.formatted);
    }
  });

  test('positive, negative, true-zero, and rounded-zero movement retain textual values', async ({ page }) => {
    const start = addDays(today(), -20), oldStart = addDays(today(), -50);
    const live = period(start, entries(start, 'w', [80, 80.01, 80.02]));
    const archived = period(oldStart, entries(oldStart, 'w', [82, 81, 80]));
    live.archive = [archive(archived)];
    await open(page, live);
    const current = metric(page, 'w').locator('svg.current .track-connector');
    const earlier = metric(page, 'w').locator('svg.archive .track-connector');
    const xs = async loc => loc.evaluate(n => [Number(n.getAttribute('x1')), Number(n.getAttribute('x2'))]);
    expect((await xs(current))[1]).toBeGreaterThan((await xs(current))[0]);
    expect((await xs(earlier))[1]).toBeLessThan((await xs(earlier))[0]);
    await expect(metric(page, 'w').locator('.period-side-current')).toContainText('Δ ±0 kg');
    await expect(metric(page, 'w').locator('.period-side-archive')).toContainText('Δ −2 kg');
    await page.evaluate(() => {
      const row = { id: 'w', current: { start: 7, end: 7, digits: 1 }, archived: { start: 7, end: 7, digits: 1 } };
      document.body.insertAdjacentHTML('beforeend', `<div id="identical">${historicalComparisonVisualHTML(row).current}${historicalComparisonVisualHTML(row).archived}</div>`);
    });
    for (const side of ['current', 'archive']) {
      const connector = page.locator(`#identical svg.${side} .track-connector`);
      const positions = await xs(connector);
      expect(positions[0]).toBeCloseTo(positions[1], 8);
      expect(positions[0]).toBeCloseTo(150, 8);
    }
  });

  test('period styles are shape and line based, accessible text remains, and one-sided rows have no placeholder graphic', async ({ page }) => {
    const start = addDays(today(), -20), oldStart = addDays(today(), -50);
    const live = period(start, entries(start, 'w', [82, 80, 78]));
    live.archive = [archive(period(oldStart, {}, { 1: { waist: 90 }, 2: { waist: 88 }, 3: { waist: 86 } }))];
    await open(page, live);
    await expect(metric(page, 'w').locator('svg.current')).toHaveCount(1);
    await expect(metric(page, 'w').locator('svg.archive')).toHaveCount(0);
    await expect(metric(page, 'waist').locator('svg.current')).toHaveCount(0);
    await expect(metric(page, 'waist').locator('svg.archive')).toHaveCount(1);
    await expect(metric(page, 'w').locator('.period-side-archive')).toContainText('Keine Trendberechnung möglich');
    await expect(metric(page, 'waist').locator('.period-side-current')).toContainText('Keine Trendberechnung möglich');
    const styles = await page.evaluate(() => {
      const current = historicalComparisonVisualHTML({ current: { start: 1, end: 2, digits: 0 }, archived: null }).current;
      const archived = historicalComparisonVisualHTML({ current: null, archived: { start: 1, end: 2, digits: 0 } }).archived;
      return { current, archived };
    });
    expect(styles.current).toContain('<circle');
    expect(styles.archived).toContain('<rect');
    expect(styles.current).not.toContain('track-connector" stroke-dasharray');
    expect(styles.archived).toContain('aria-hidden="true"');
    expect(styles.archived).toContain('focusable="false"');
    expect(await page.locator('.comparison-value-track').first().getAttribute('tabindex')).toBeNull();
    expect(await page.locator('svg.archive .track-connector').first().evaluate(n => getComputedStyle(n).strokeDasharray)).not.toBe('none');
    await expect(metric(page, 'w')).toContainText('Aktueller Durchgang');
    await expect(metric(page, 'w')).toContainText('Früherer Durchgang');
    const text = await page.locator('#historicalComparison').innerText();
    expect(text).not.toMatch(/Gewinner|besser|schlechter|Verbesserung|Score|Korrelation|Differenz zwischen Durchgängen/i);
  });

  test('cutoffs and selector update visuals and text without state, archive, or storage mutation', async ({ page }) => {
    const start = addDays(today(), -15), old = addDays(today(), -50);
    const live = period(start, { ...entries(start, 'w', [82, 80, 78]), [addDays(start, 16)]: { w: 10 } });
    live.archive = [archive(period(old, { ...entries(old, 'w', [90, 89, 88]), [addDays(old, 21)]: { w: 1 } }),
      'Earlier', addDays(old, 14)), archive(period(old, entries(old, 'w', [85, 84, 83])), 'Later')];
    await open(page, live);
    await expect(page.locator('#historicalArchive')).toHaveValue('1');
    const before = await page.evaluate(() => ({ state: JSON.stringify(S), archive: JSON.stringify(S.archive),
      primary: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY) }));
    const laterX = await metric(page, 'w').locator('svg.archive .track-end').getAttribute('x');
    await page.locator('#historicalArchive').selectOption('0');
    await expect(page.locator('#historicalComparisonContent')).toContainText('Earlier');
    await expect(metric(page, 'w').locator('.period-side-current')).toContainText('3 Werte · 3 Wochen');
    await expect(metric(page, 'w').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
    const earlierX = await metric(page, 'w').locator('svg.archive .track-end').getAttribute('x');
    expect(earlierX).not.toBe(laterX);
    const cutoff = await page.evaluate(() => experimentPeriodComparison(S, S.archive[0]).archivedAsOf);
    expect(cutoff).toBe(addDays(old, 14));
    const after = await page.evaluate(() => ({ state: JSON.stringify(S), archive: JSON.stringify(S.archive),
      primary: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY) }));
    expect(after).toEqual(before);
  });

  test('malformed and future archives render no visuals while the neutral empty case stays intact', async ({ page }) => {
    const old = addDays(today(), -50), start = addDays(today(), -20);
    const live = period(start, entries(start, 'w', [82, 80, 78]));
    live.archive = [archive({ settings: { start: old, days: 28 }, days: { [old]: null }, weeks: {} }, 'Malformed'),
      archive({ ...period(old, entries(old, 'w', [90, 80, 70])), dataVersion: 999 }, 'Future')];
    await open(page, live);
    for (const value of ['1', '0']) {
      await page.locator('#historicalArchive').selectOption(value);
      await expect(page.locator('#historicalComparisonContent')).toContainText('nicht ausgewertet werden');
      await expect(page.locator('#historicalComparisonContent .comparison-value-track')).toHaveCount(0);
    }
    const empty = period(start);
    empty.archive = [archive(period(old))];
    await seed(page, empty);
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(page.locator('#historicalComparisonContent')).toContainText('noch nicht genügend Wochen mit Daten');
    await expect(page.locator('#historicalComparisonContent .comparison-value-track')).toHaveCount(0);
  });

  test('release metadata is synchronized and historical visuals never enter report HTML', async ({ page }) => {
    const start = addDays(today(), -20);
    const live = period(start, entries(start, 'w', [82, 80, 78]));
    live.archive = [archive(period(start, entries(start, 'w', [84, 82, 80])))];
    await open(page, live);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.7.4', schema: 6, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
    const report = await page.evaluate(() => reportHTML());
    expect(report).not.toContain('comparison-value-track');
    expect(report).not.toContain('historicalComparison');
  });
});
