const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

async function visibilityChange(page, state) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  }, state);
}

test.describe('Mobile lifecycle autosave', () => {
  test('pagehide saves a focused day note before change or blur', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.fill('#f_note', 'Synthetic pending day note');
    expect(await page.evaluate(() => S.days[today()]?.note)).toBeUndefined();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    await expect(page.locator('#f_note')).toHaveValue('Synthetic pending day note');
    expect(await page.evaluate(() => S.settings.lastBackup)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem(RECOVERY_KEY))).toBeNull();
  });

  test('pagehide saves a focused valid numeric day value', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.fill('#f_w', '82');
    expect(await page.evaluate(() => S.days[today()]?.w)).toBeUndefined();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    await expect(page.locator('#f_w')).toHaveValue('82');
    expect(await page.evaluate(() => S.days[today()].w)).toBe(82);
  });

  test('visibilitychange saves a focused Settings text edit', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="set"]');
    await page.fill('#s_name', 'Synthetic pending name');
    expect(await page.evaluate(() => S.settings.name)).toBe('');
    await visibilityChange(page, 'hidden');
    await page.reload();
    await page.click('nav button[data-tab="set"]');
    await expect(page.locator('#s_name')).toHaveValue('Synthetic pending name');
    expect(await page.evaluate(() => S.settings.lastBackup)).toBeNull();
  });

  test('invalid focused numeric text does not replace the previously stored valid value', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({ days: { [today()]: { w: 80 } } }));
    await page.fill('#f_w', 'invalid');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)).days[today()].w)).toBe(80);
    await page.reload();
    await expect(page.locator('#f_w')).toHaveValue('80');
  });

  test('invalid pending doctor threshold keeps its value and dated history on pagehide', async ({ page }) => {
    await gotoApp(page);
    const alerts = { ...blankState().settings.alerts, gMax: 160 };
    await seed(page, blankState({ settings: {
      ...blankState().settings, alerts, alertHistory: [{ date: null, value: alerts }],
    } }));
    await page.click('nav button[data-tab="set"]');
    const before = await page.evaluate(() => ({ alerts: JSON.stringify(S.settings.alerts), history: JSON.stringify(S.settings.alertHistory) }));
    await page.fill('#v-set input[data-al="gMax"]', 'abc');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(page.locator('#status')).toContainText('Bitte eine Zahl eingeben');
    const after = await page.evaluate(() => ({
      alerts: JSON.stringify(S.settings.alerts), history: JSON.stringify(S.settings.alertHistory),
      stored: JSON.parse(localStorage.getItem(KEY)).settings,
    }));
    expect(after.alerts).toBe(before.alerts);
    expect(after.history).toBe(before.history);
    expect(after.stored.alerts.gMax).toBe(160);
    expect(JSON.stringify(after.stored.alertHistory)).toBe(before.history);
    await page.reload();
    await page.click('nav button[data-tab="set"]');
    await expect(page.locator('#v-set input[data-al="gMax"]')).toHaveValue('160');
  });

  test('clearing a pending doctor threshold intentionally stores null on pagehide', async ({ page }) => {
    await gotoApp(page);
    const alerts = { ...blankState().settings.alerts, gMax: 160 };
    await seed(page, blankState({ settings: {
      ...blankState().settings, alerts, alertHistory: [{ date: null, value: alerts }],
    } }));
    await page.click('nav button[data-tab="set"]');
    await page.fill('#v-set input[data-al="gMax"]', '');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    expect(await page.evaluate(() => ({
      current: S.settings.alerts.gMax,
      baseline: S.settings.alertHistory[0].value.gMax,
      latest: S.settings.alertHistory.at(-1).value.gMax,
      stored: JSON.parse(localStorage.getItem(KEY)).settings.alerts.gMax,
    }))).toEqual({ current: null, baseline: 160, latest: null, stored: null });
  });

  test('lifecycle flush with no active editable field does not throw', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    const result = await page.evaluate(() => {
      document.activeElement.blur?.();
      return flushPendingEdit();
    });
    expect(result).toBe(true);
    expect(await page.evaluate(() => S.settings.lastBackup)).toBeNull();
  });

  test('visibilitychange also flushes a focused day textarea', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.fill('#f_note', 'Synthetic visibility note');
    await visibilityChange(page, 'hidden');
    await page.reload();
    await expect(page.locator('#f_note')).toHaveValue('Synthetic visibility note');
  });

  test('visible visibilitychange leaves a pending edit untouched until hidden', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.fill('#f_note', 'Synthetic pending visibility note');
    const before = await page.evaluate(() => localStorage.getItem(KEY));
    await visibilityChange(page, 'visible');
    expect(await page.evaluate(() => ({ note: S.days[today()]?.note, stored: localStorage.getItem(KEY) }))).toEqual({
      note: undefined, stored: before,
    });
    await visibilityChange(page, 'hidden');
    await page.reload();
    await expect(page.locator('#f_note')).toHaveValue('Synthetic pending visibility note');
  });
});
