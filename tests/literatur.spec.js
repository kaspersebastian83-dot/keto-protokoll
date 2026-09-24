const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState } = require('./helpers');

test.describe('Literatur tab', () => {
  test('REFERENCES has exactly 13 entries', async ({ page }) => {
    await gotoApp(page);
    const count = await page.evaluate(() => REFERENCES.length);
    expect(count).toBe(13);
  });

  test('checkbox toggles S.refRead, updates the progress counter, and persists across reload', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="lit"]');

    await expect(page.locator('#v-lit .panel .sub').first()).toHaveText('0 von 13 gelesen');

    const firstId = await page.evaluate(() => REFERENCES[0].id);
    await page.click(`#v-lit input[data-ref="${firstId}"]`);
    await page.waitForTimeout(50);

    await expect(page.locator('#v-lit .panel .sub').first()).toHaveText('1 von 13 gelesen');
    const inMemory = await page.evaluate((id) => S.refRead[id], firstId);
    expect(inMemory).toBe(true);

    await page.reload();
    await page.click('nav button[data-tab="lit"]');
    await expect(page.locator(`#v-lit input[data-ref="${firstId}"]`)).toBeChecked();
    await expect(page.locator('#v-lit .panel .sub').first()).toHaveText('1 von 13 gelesen');
  });

  test('an old backup without refRead migrates cleanly to {}', async ({ page }) => {
    await gotoApp(page);
    const old = { settings: { name: '', start: '2026-01-01', days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] }, days: {}, weeks: {}, labs: [], labDates: { base: '', end: '' }, doseChanges: [], archive: [] };
    await seed(page, old);

    const refRead = await page.evaluate(() => S.refRead);
    expect(refRead).toEqual({});

    await page.click('nav button[data-tab="lit"]');
    await expect(page.locator('#v-lit .panel .sub').first()).toHaveText('0 von 13 gelesen');
  });
});
