const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const fullWeek = { waist: 84, rhr: 60, sleep: 7, stress: 35, steps: 0 };
const card = '#v-day .weekly-checkin-card';

function stateOnTrackingDay(day, { days = 90, weeks = {}, settings = {} } = {}) {
  return blankState({ settings: { start: addDays(today(), 1 - day), days, ...settings }, weeks });
}

async function openOnTrackingDay(page, day, options) {
  await gotoApp(page);
  await seed(page, stateOnTrackingDay(day, options));
}

test.describe('Weekly check-in on Today', () => {
  test('tracking days 1 through 6 have no weekly card', async ({ page }) => {
    await gotoApp(page);
    for (let day = 1; day <= 6; day++) {
      await seed(page, stateOnTrackingDay(day));
      await expect(page.locator(card)).toHaveCount(0);
      expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBeNull();
    }
  });

  test('day 7 prompts empty week 1 after the daytime panel', async ({ page }) => {
    await openOnTrackingDay(page, 7, { days: 7 });
    await expect(page.locator(card)).toContainText('Zeit für den Wochen-Check-in.');
    await expect(page.locator(card)).toContainText('Woche 1 · 0 von 5 Wochenwerten erfasst');
    expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBe(1);
    const headings = await page.locator('#v-day .panel h2').allTextContents();
    expect(headings.indexOf('Wochen-Check-in')).toBeGreaterThan(headings.indexOf('Über den Tag'));
  });

  test('partial weekly values show progress from the five WF fields', async ({ page }) => {
    await openOnTrackingDay(page, 7, { weeks: { 1: { waist: 84, sleep: 7 } } });
    await expect(page.locator(card)).toContainText('Woche 1 · 2 von 5 Wochenwerten erfasst');
    expect(await page.evaluate(() => weeklyCheckinProgress(1))).toEqual({ completed: 2, total: 5 });
  });

  test('all five values complete the check-in without a note, including a zero value', async ({ page }) => {
    await openOnTrackingDay(page, 7, { weeks: { 1: fullWeek } });
    await expect(page.locator(card)).toHaveCount(0);
    expect(await page.evaluate(() => weeklyCheckinComplete(1))).toBe(true);
    expect(await page.evaluate(() => S.weeks[1].note)).toBeUndefined();
  });

  test('a weekly note alone leaves progress at zero of five', async ({ page }) => {
    await openOnTrackingDay(page, 7, { weeks: { 1: { note: 'Synthetic weekly note' } } });
    await expect(page.locator(card)).toContainText('0 von 5 Wochenwerten erfasst');
    expect(await page.evaluate(() => weeklyCheckinComplete(1))).toBe(false);
  });

  test('days 8 and 13 prompt only the immediately previous incomplete week', async ({ page }) => {
    await gotoApp(page);
    for (const day of [8, 13]) {
      await seed(page, stateOnTrackingDay(day));
      await expect(page.locator(card)).toContainText('Woche 1 nachtragen.');
      await expect(page.locator(card)).toContainText('Woche 1 · 0 von 5 Wochenwerten erfasst');
      expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBe(1);
    }
  });

  test('day 14 prompts current week 2 ahead of incomplete week 1', async ({ page }) => {
    await openOnTrackingDay(page, 14);
    await expect(page.locator(card)).toContainText('Woche 2 · 0 von 5 Wochenwerten erfasst');
    await expect(page.locator(card)).not.toContainText('Woche 1');
    expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBe(2);
  });

  test('week 3 does not search back to incomplete week 1 after week 2 is complete', async ({ page }) => {
    await openOnTrackingDay(page, 15, { weeks: { 2: fullWeek } });
    await expect(page.locator(card)).toHaveCount(0);
    expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBeNull();
  });

  test('card navigation opens the selected existing week without changing stored data', async ({ page }) => {
    await openOnTrackingDay(page, 8, { weeks: { 1: { waist: 84 } }, settings: { lastBackup: '2026-01-01' } });
    const before = await page.evaluate(() => ({
      days: JSON.stringify(S.days), weeks: JSON.stringify(S.weeks), lastBackup: S.settings.lastBackup,
      recovery: localStorage.getItem(RECOVERY_KEY), stored: localStorage.getItem(KEY),
    }));
    await page.getByRole('button', { name: 'Wochen-Check-in öffnen' }).click();
    await expect(page.locator('nav button[data-tab="week"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#v-week')).toBeVisible();
    await expect(page.locator('#wsel')).toHaveValue('1');
    await expect(page.locator('#w_waist')).toHaveValue('84');
    expect(await page.evaluate(() => curWeek)).toBe(1);
    expect(await page.evaluate(() => ({
      days: JSON.stringify(S.days), weeks: JSON.stringify(S.weeks), lastBackup: S.settings.lastBackup,
      recovery: localStorage.getItem(RECOVERY_KEY), stored: localStorage.getItem(KEY),
    }))).toEqual(before);
  });

  test('the final partial week is due on the last day of a 10-day period', async ({ page }) => {
    await openOnTrackingDay(page, 10, { days: 10 });
    await expect(page.locator(card)).toContainText('Woche 2 · 0 von 5 Wochenwerten erfasst');
    expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBe(2);
  });

  test('today before the start or after the end has no weekly card', async ({ page }) => {
    await gotoApp(page);
    for (const [day, days] of [[0, 7], [11, 10]]) {
      await seed(page, stateOnTrackingDay(day, { days }));
      await expect(page.locator(card)).toHaveCount(0);
      expect(await page.evaluate(() => weeklyCheckinDueWeek())).toBeNull();
    }
  });

  test('browsing historical and future dates never shows the Today weekly card', async ({ page }) => {
    await openOnTrackingDay(page, 7);
    await expect(page.locator(card)).toBeVisible();
    await page.locator('[data-nav="-1"]').click();
    await expect(page.locator(card)).toHaveCount(0);
    await page.locator('[data-nav="1"]').click();
    await expect(page.locator(card)).toBeVisible();
    await page.locator('[data-nav="1"]').click();
    await expect(page.locator(card)).toHaveCount(0);
  });

  test('returning to Today after all five entries removes the card', async ({ page }) => {
    await openOnTrackingDay(page, 7);
    await page.getByRole('button', { name: 'Wochen-Check-in öffnen' }).click();
    for (const [field, value] of Object.entries(fullWeek)) await page.locator(`#w_${field}`).fill(String(value));
    await page.locator('#w_note').focus();
    await page.locator('nav button[data-tab="day"]').click();
    await expect(page.locator(card)).toHaveCount(0);
    expect(await page.evaluate(() => weeklyCheckinComplete(1))).toBe(true);
    expect(await page.evaluate(() => S.weeks[1].note)).toBeUndefined();
  });

  test('returning to Today after partial entries keeps the card with updated progress', async ({ page }) => {
    await openOnTrackingDay(page, 7);
    await page.getByRole('button', { name: 'Wochen-Check-in öffnen' }).click();
    await page.locator('#w_waist').fill('84');
    await page.locator('#w_sleep').fill('7');
    await page.locator('#w_note').focus();
    await page.locator('nav button[data-tab="day"]').click();
    await expect(page.locator(card)).toContainText('2 von 5 Wochenwerten erfasst');
  });

  test('release and storage metadata stay unchanged apart from version 1.6.2', async ({ page }) => {
    await openOnTrackingDay(page, 7);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.6.2', schema: 6, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
  });
});
