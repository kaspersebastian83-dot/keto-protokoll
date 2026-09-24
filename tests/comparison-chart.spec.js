const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, addDays, today } = require('./helpers');

test.describe('Comparison chart (Verlauf)', () => {
  test('defaults to Kohlenhydrate/Ketone and renders both series', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -20);
    const state = blankState({ settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    for (let i = 0; i < 15; i++) state.days[addDays(start, i)] = { c: i % 2 ? 70 : 30, k: i % 2 ? 0.4 : 1.2 };
    await seed(page, state);

    await page.click('nav button[data-tab="trend"]');
    await page.waitForTimeout(100);

    await expect(page.locator('#cmpA')).toHaveValue('c');
    await expect(page.locator('#cmpB')).toHaveValue('k');
    const html = await page.locator('#cmpChart').innerHTML();
    expect(html).not.toContain('Für diese Kombination');
    expect((html.match(/<path/g) || []).length).toBe(2);
  });

  test('shows the placeholder message when the pair has no overlapping data', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -20);
    const state = blankState({ settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    for (let i = 0; i < 15; i++) state.days[addDays(start, i)] = { c: 40 }; // no 'stress' ever logged
    await seed(page, state);

    await page.click('nav button[data-tab="trend"]');
    await page.waitForTimeout(100);
    await page.selectOption('#cmpB', 'stress');
    await page.waitForTimeout(100);

    const html = await page.locator('#cmpChart').innerHTML();
    expect(html).toContain('Für diese Kombination liegen noch keine gemeinsamen Werte vor.');
  });

  test('switching dropdowns does not re-render the fixed chart panel', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -20);
    const state = blankState({ settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] } });
    for (let i = 0; i < 15; i++) state.days[addDays(start, i)] = { w: 80, c: 40, k: 1 };
    state.weeks[1] = { rhr: 64 };
    await seed(page, state);

    await page.click('nav button[data-tab="trend"]');
    await page.waitForTimeout(100);

    await page.evaluate(() => { window.__marker = document.querySelector('#v-trend .panel'); window.__marker.dataset.probe = 'unchanged'; });
    await page.selectOption('#cmpA', 'w');
    await page.selectOption('#cmpB', 'rhr');
    await page.waitForTimeout(100);

    const same = await page.evaluate(() => document.querySelector('#v-trend .panel') === window.__marker && document.querySelector('#v-trend .panel').dataset.probe === 'unchanged');
    expect(same).toBe(true);
  });
});
