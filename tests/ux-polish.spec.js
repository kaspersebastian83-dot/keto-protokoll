const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const ids = ['w', 'g', 'k', 'bp', 'p'];
const schedule = due => Object.fromEntries(ids.map(id => [id, {
  mode: due.includes(id) ? 'daily' : 'optional', weekdays: [],
}]));
async function openToday(page, due, overrides = {}) {
  await gotoApp(page);
  await seed(page, blankState({ ...overrides, settings: {
    ...blankState().settings, ...overrides.settings, measurementSchedule: schedule(due),
  } }));
}

test.describe('Today and Week UX polish', () => {
  test('incomplete, complete and no-due progress retain neutral numeric meaning', async ({ page }) => {
    await openToday(page, ['w', 'g'], { days: { [today()]: { w: 82 } } });
    await expect(page.locator('#todayProgress')).toHaveText('Vorgesehene Messungen: 1 von 2 erfasst');
    await page.locator('#f_g').fill('94');
    await page.locator('#f_note').focus();
    await expect(page.locator('#todayProgress')).toHaveText('Vorgesehene Messungen vollständig erfasst · 2 von 2');
    await openToday(page, []);
    await expect(page.locator('#todayProgress')).toHaveText('Laut deinem Messplan ist heute keine Messung vorgesehen.');
    await expect(page.locator('#todayProgress')).toHaveAttribute('aria-live', 'polite');
  });

  test('completed summary keeps label, value, action and warning apart from its original input', async ({ page }) => {
    await openToday(page, ['w'], { days: { [today()]: { w: 820 } } });
    const item = page.locator('[data-today-measurement="w"]');
    await expect(item.locator('summary')).toContainText('Gewicht');
    await expect(item.locator('summary')).toContainText('820 kg');
    await expect(item.locator('.today-action')).toHaveText('Ändern');
    await expect(item.locator('.today-warning')).toContainText('Ungewöhnlicher Wert');
    await expect(item.locator('summary')).toHaveCSS('cursor', 'pointer');
    await item.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(item.locator('details')).toHaveAttribute('open', '');
    await expect(item.locator('#f_w')).toBeVisible();
    await expect(item.locator('#f_w')).toHaveValue('820');
  });

  test('extra disclosure starts closed, opens by keyboard and does not duplicate inputs or IDs', async ({ page }) => {
    await openToday(page, ['w'], { days: { [today()]: { w: 82 } } });
    await expect(page.locator('#todayExtra')).not.toHaveAttribute('open', '');
    await expect(page.locator('#todayExtraSummary')).toContainText('Weitere Werte eintragen');
    await page.locator('[data-today-measurement="w"] summary').click();
    await page.locator('#todayExtraSummary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#todayExtra')).toHaveAttribute('open', '');
    await expect(page.locator('#f_g')).toBeVisible();
    const inputCount = await page.locator('#todayDue input[data-f],#todayExtra input[data-f]').count();
    const idsOnPage = await page.locator('#v-day [id]').evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(idsOnPage).size).toBe(idsOnPage.length);
    expect(inputCount).toBe(8); // Four single measurements and four BP readings.
  });

  test('historical day keeps the full form without Today completion or weekly card', async ({ page }) => {
    await openToday(page, ['w'], { settings: { start: addDays(today(), -6), days: 14 } });
    await expect(page.locator('.weekly-checkin-card')).toBeVisible();
    await page.locator('[data-nav="-1"]').click();
    await expect(page.getByRole('heading', { name: 'Morgens, nüchtern' })).toBeVisible();
    await expect(page.locator('#todayProgress,.weekly-checkin-card')).toHaveCount(0);
    for (const field of ['#f_w', '#f_g', '#f_k', '#f_sys1', '#f_sys2', '#f_p'])
      await expect(page.locator(field)).toBeVisible();
  });

  test('weekly check-in remains derived and opens the existing Week screen', async ({ page }) => {
    await openToday(page, ids, { settings: { start: addDays(today(), -6), days: 14 },
      weeks: { 1: { waist: 84, steps: 0 } } });
    const card = page.locator('.weekly-checkin-card');
    await expect(card).toContainText('Woche 1 · 2 von 5 Wochenwerten erfasst');
    await card.getByRole('button', { name: 'Wochen-Check-in öffnen' }).click();
    await expect(page.locator('#v-week')).toBeVisible();
    await expect(page.locator('#wsel')).toHaveValue('1');
    expect(await page.evaluate(() => S.weeks[1])).toEqual({ waist: 84, steps: 0 });
  });

  test('release version, schema and storage keys are synchronized', async ({ page }) => {
    await gotoApp(page);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.7.2', schema: 6, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
  });
});
