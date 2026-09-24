const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState } = require('./helpers');

test.describe('Lab table', () => {
  test('parseRange handles all four forms plus unparseable input', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => ({
      range: parseRange('70-99'),
      commaRange: parseRange('70,0-99,0'),
      lessThan: parseRange('<200'),
      greaterThan: parseRange('>40'),
      garbage: parseRange('not a range'),
      empty: parseRange(''),
    }));
    expect(r.range).toEqual({ min: 70, max: 99 });
    expect(r.commaRange).toEqual({ min: 70, max: 99 });
    expect(r.lessThan).toEqual({ min: null, max: 200 });
    expect(r.greaterThan).toEqual({ min: 40, max: null });
    expect(r.garbage).toEqual({ min: null, max: null });
    expect(r.empty).toEqual({ min: null, max: null });
  });

  test('isOutOfRange flags correctly for each form, never for unparseable ranges', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => ({
      belowRange: isOutOfRange(65, '70-99'),
      withinRange: isOutOfRange(85, '70-99'),
      aboveLessThan: isOutOfRange(250, '<200'),
      belowGreaterThan: isOutOfRange(30, '>40'),
      nullValue: isOutOfRange(null, '70-99'),
      unparseable: isOutOfRange(999, 'garbage'),
    }));
    expect(r.belowRange).toBe(true);
    expect(r.withinRange).toBe(false);
    expect(r.aboveLessThan).toBe(true);
    expect(r.belowGreaterThan).toBe(true);
    expect(r.nullValue).toBe(false);
    expect(r.unparseable).toBe(false);
  });

  test('marker and legend appear live for an out-of-range value and clear when fixed', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      labs: [{ name: 'Testwert', unit: 'mg/dl', range: '70-99', base: '', end: '' }],
    }));
    await page.click('nav button[data-tab="lab"]');

    await page.fill('.labtbl input[data-lk="base"] >> nth=0', '150');
    await page.locator('.labtbl input[data-lk="base"] >> nth=0').blur();

    await expect(page.locator('.labtbl input.oor')).toHaveCount(1);
    await expect(page.locator('#v-lab')).toContainText('außerhalb des angegebenen Normbereichs');

    await page.fill('.labtbl input[data-lk="base"] >> nth=0', '85');
    await page.locator('.labtbl input[data-lk="base"] >> nth=0').blur();

    await expect(page.locator('.labtbl input.oor')).toHaveCount(0);
    await expect(page.locator('#v-lab')).not.toContainText('außerhalb des angegebenen Normbereichs');
  });
});
