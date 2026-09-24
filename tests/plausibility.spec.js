const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('Plausibility hints', () => {
  test('appear for an out-of-range value and never block saving', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_w', '820'); // obviously implausible weight
    await page.locator('#f_w').blur();

    await expect(page.locator('#hint_w')).toBeVisible();
    const saved = await page.evaluate(() => S.days[today()].w);
    expect(saved).toBe(820); // saved exactly as typed despite being flagged
  });

  test('disappear once the value becomes plausible', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_w', '820');
    await page.locator('#f_w').blur();
    await expect(page.locator('#hint_w')).toBeVisible();

    await page.fill('#f_w', '82');
    await page.locator('#f_w').blur();
    await expect(page.locator('#hint_w')).toBeHidden();
  });

  test('disappear when the field is cleared', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_g', '9'); // far below plausible glucose range
    await page.locator('#f_g').blur();
    await expect(page.locator('#hint_g')).toBeVisible();

    await page.fill('#f_g', '');
    await page.locator('#f_g').blur();
    await expect(page.locator('#hint_g')).toBeHidden();
  });

  test('blood pressure hint flags systolic not higher than diastolic, saving anyway', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.fill('#f_sys1', '80');
    await page.locator('#f_sys1').blur();
    await page.fill('input[data-f="dia1"]', '90');
    await page.locator('input[data-f="dia1"]').blur();

    await expect(page.locator('#hint_bp1')).toBeVisible();
    const saved = await page.evaluate(() => S.days[today()]);
    // reading 1 saved exactly as typed, and with no second reading the derived sys/dia equal it
    expect(saved.sys1).toBe(80);
    expect(saved.dia1).toBe(90);
    expect(saved.sys).toBe(80);
    expect(saved.dia).toBe(90);
  });

  test('weight day-jump hint compares against the previous logged day', async ({ page }) => {
    await gotoApp(page);
    const yesterday = addDays(today(), -1);
    await seed(page, blankState({ days: { [yesterday]: { w: 80 } } }));

    await page.fill('#f_w', '90'); // 10kg jump in one day
    await page.locator('#f_w').blur();

    await expect(page.locator('#hint_w')).toBeVisible();
    await expect(page.locator('#hint_w')).toHaveText(/Sprung/);
  });
});
