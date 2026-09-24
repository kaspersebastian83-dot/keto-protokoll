const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

test.describe('Daily entry', () => {
  test('values save and persist across reload', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_w', '82,5');
    await page.locator('#f_w').blur();
    await page.fill('#f_g', '95');
    await page.locator('#f_g').blur();

    await page.reload();
    await expect(page.locator('#f_w')).toHaveValue('82,5');
    await expect(page.locator('#f_g')).toHaveValue('95');
  });

  test('comma decimals parse into numeric values', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_k', '1,25');
    await page.locator('#f_k').blur();

    const stored = await page.evaluate(() => S.days[today()].k);
    expect(stored).toBe(1.25);
  });

  test('invalid text does not save and shows a status message', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_w', 'abc');
    await page.locator('#f_w').blur();

    const stored = await page.evaluate(() => (S.days[today()] || {}).w);
    expect(stored).toBeUndefined();
    await expect(page.locator('#status')).toHaveText('Bitte eine Zahl eingeben');
  });
});
