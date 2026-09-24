const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, addDays } = require('./helpers');

test.describe('trendFit()', () => {
  test('returns null below 3 points', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => trendFit([[1, 10], [2, 12]]));
    expect(r).toBeNull();
  });

  test('recovers exact coefficients for a perfect line', async ({ page }) => {
    await gotoApp(page);
    // y = 2x + 8
    const r = await page.evaluate(() => trendFit([[1, 10], [2, 12], [3, 14], [4, 16]]));
    expect(r.a).toBeCloseTo(8, 6);
    expect(r.b).toBeCloseTo(2, 6);
    expect(r.n).toBe(4);
  });

  test('moderates a single-week outlier compared to the raw endpoint method', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-01-05';
    const state = blankState({ settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    // Week 1 has a wild outlier (200); weeks 2-9 are stable (~95).
    for (let w = 0; w < 9; w++) {
      const g = w === 0 ? 200 : 95;
      for (let d = 0; d < 7; d++) {
        const ds = addDays(start, w * 7 + d);
        state.days[ds] = { g };
      }
    }
    await seed(page, state);

    const result = await page.evaluate(() => {
      const oldFirstLast = (f) => {
        let fi = null, la = null;
        for (let w = 1; w <= nWeeks(); w++) { const [a, b] = weekRange(w); const v = avg(a, b, f); if (v != null) { if (!fi) fi = [w, v]; la = [w, v]; } }
        return [fi, la];
      };
      const [fi, la] = oldFirstLast('g');
      const oldDelta = fi && la ? la[1] - fi[1] : null;

      const pairs = [];
      for (let w = 1; w <= nWeeks(); w++) { const [a, b] = weekRange(w); const v = avg(a, b, 'g'); if (v != null) pairs.push([w, v]); }
      const t = trendFit(pairs);
      const newDelta = t ? (t.a + t.b * pairs.at(-1)[0]) - (t.a + t.b * pairs[0][0]) : null;

      return { oldDelta, newDelta };
    });

    expect(result.oldDelta).toBe(-105); // 95 - 200, entirely driven by the one outlier week
    expect(Math.abs(result.newDelta)).toBeLessThan(Math.abs(result.oldDelta) * 0.75);
  });

  test('report table falls back to "zu wenige Wochen" with under 3 weeks of data', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-01-05';
    const state = blankState({ settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    for (let d = 0; d < 10; d++) state.days[addDays(start, d)] = { p: 70 }; // only spans 2 weeks
    await seed(page, state);

    const html = await page.evaluate(() => reportHTML());
    expect(html).toContain('Anfang (Trend)');
    expect(html).toContain('Ende (Trend)');
    expect(html).toMatch(/<tr><td>Puls<\/td><td>\/min<\/td><td class="num">–<\/td><td class="num">–<\/td><td class="num">zu wenige Wochen<\/td><\/tr>/);
  });
});
