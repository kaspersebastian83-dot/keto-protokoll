const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

test.describe('iPhone-sized WebKit smoke checks', () => {
  test('Today loads without a page error and daily entries survive reload', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await gotoApp(page);
    await seed(page, blankState());
    await expect(page.locator('#v-day')).toBeVisible();
    await expect(page.locator('nav button[data-tab="day"]')).toHaveAttribute('aria-selected', 'true');

    await page.locator('#f_w').tap();
    await page.locator('#f_w').fill('82');
    await page.locator('#f_note').tap();
    await page.locator('#f_note').fill('Synthetic mobile note');
    await page.locator('[data-today-measurement="w"] summary').tap();
    await page.locator('#f_w').tap();
    expect(await page.evaluate(() => S.days[today()])).toMatchObject({ w: 82, note: 'Synthetic mobile note' });

    await page.reload();
    await expect(page.locator('#f_w')).toHaveValue('82');
    await expect(page.locator('#f_note')).toHaveValue('Synthetic mobile note');
    expect(errors).toEqual([]);
  });

  test('touch navigation reaches primary views without document overflow', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    for (const [tab, section, control] of [
      ['day', '#v-day', '#f_w'],
      ['week', '#v-week', '#wsel'],
      ['lab', '#v-lab', '#lb_base'],
      ['trend', '#v-trend', '#cmpA'],
      ['set', '#v-set', '#s_name'],
    ]) {
      await page.locator(`nav button[data-tab="${tab}"]`).tap();
      await expect(page.locator(section)).toBeVisible();
      await expect(page.locator(control)).toBeVisible();
      await expect(page.locator(control)).toBeEnabled();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${tab} should not make the document scroll sideways`).toBeLessThanOrEqual(2);
    }
  });

  test('backup controls are touch reachable while the import input stays hidden', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.locator('nav button[data-tab="set"]').tap();
    await expect(page.locator('#importFile')).toBeHidden();
    await expect(page.locator('#exp')).toBeEnabled();
    await expect(page.locator('#imp')).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exp').tap()]);
    expect(download.suggestedFilename()).toMatch(/^keto-protokoll-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#imp').tap()]);
    expect(chooser.isMultiple()).toBe(false);
    await expect(page.locator('#importFile')).toBeHidden();
  });

  test('a synthetic backup imports and its previous live state restores through touch UI', async ({ page }) => {
    await gotoApp(page);
    const live = blankState({
      settings: { ...blankState().settings, name: 'Synthetic live profile' },
      days: { [today()]: { w: 80 } },
    });
    const imported = blankState({
      settings: { ...blankState().settings, name: 'Synthetic imported profile' },
      days: { [today()]: { g: 95 } },
    });
    await seed(page, live);
    await page.locator('nav button[data-tab="set"]').tap();
    page.once('dialog', dialog => dialog.accept());
    await page.setInputFiles('#importFile', {
      name: 'synthetic-mobile-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Synthetic imported profile');
    expect(await page.evaluate(() => ({
      live: S.days[today()].g,
      recovery: JSON.parse(localStorage.getItem(RECOVERY_KEY)).data.settings.name,
    }))).toEqual({ live: 95, recovery: 'Synthetic live profile' });

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#restoreRecovery').tap();
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Synthetic live profile');
    expect(await page.evaluate(() => ({
      weight: S.days[today()].w, recovery: localStorage.getItem(RECOVERY_KEY),
    }))).toEqual({ weight: 80, recovery: null });
  });

  test('touch Settings schedule changes persist after reload', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.locator('nav button[data-tab="set"]').tap();
    await page.locator('#ms_k').selectOption('weekdays');
    const first = await page.evaluate(() => isoWeekday(today()));
    const other = first === 7 ? 1 : first + 1;
    await page.locator(`[data-ms-id="k"][data-ms-day="${other}"]`).tap();
    const expected = [first, other].sort((a, b) => a - b);
    await page.reload();
    await page.locator('nav button[data-tab="set"]').tap();
    await expect(page.locator('#ms_k')).toHaveValue('weekdays');
    expect(await page.evaluate(() => S.settings.measurementSchedule.k.weekdays)).toEqual(expected);
    await expect(page.locator(`[data-ms-id="k"][data-ms-day="${other}"]`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('quick Today exposes non-due values through touch without overflow', async ({ page }) => {
    const state = blankState();
    state.settings.measurementSchedule.g = { mode: 'optional', weekdays: [] };
    await gotoApp(page);
    await seed(page, state);
    await expect(page.locator('#todayDue #f_w')).toBeVisible();
    await expect(page.locator('#todayDue #f_g')).toHaveCount(0);
    await page.locator('#todayExtraSummary').tap();
    await expect(page.locator('#todayExtra #f_g')).toBeVisible();
    await page.locator('#f_g').tap();
    await page.locator('#f_g').fill('94');
    await page.locator('#f_g').blur();
    await expect(page.locator('#todayExtraSummary')).toContainText('1 eingetragen');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    await page.reload();
    await expect(page.locator('#todayExtraSummary')).toContainText('1 eingetragen');
    await page.locator('#todayExtraSummary').tap();
    await expect(page.locator('#f_g')).toHaveValue('94');
  });
});
