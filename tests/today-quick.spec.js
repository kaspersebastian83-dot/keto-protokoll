const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const ids = ['w', 'g', 'k', 'bp', 'p'];
const fields = ['#f_w', '#f_g', '#f_k', '#f_sys1', '#f_sys2', '#f_p'];
const schedule = (due = []) => Object.fromEntries(ids.map(id => [id, {
  mode: due.includes(id) ? 'daily' : 'optional', weekdays: [],
}]));
const withSchedule = (due, overrides = {}) => blankState({
  ...overrides,
  settings: { ...blankState().settings, ...overrides.settings, measurementSchedule: schedule(due) },
});
async function openToday(page, state = blankState()) {
  await gotoApp(page);
  await seed(page, state);
}

test.describe('Quick Today entry', () => {
  test('all-daily Today shows five due inputs and an empty neutral count', async ({ page }) => {
    await openToday(page);
    await expect(page.locator('#todayDue h2')).toHaveText('Heute vorgesehen');
    await expect(page.locator('#todayProgress')).toHaveText('Vorgesehene Messungen: 0 von 5 erfasst');
    await expect(page.locator('#todayProgress')).toHaveAttribute('aria-live', 'polite');
    for (const field of fields) await expect(page.locator(`#todayDue ${field}`)).toBeVisible();
    await expect(page.locator('#todayExtra')).toHaveCount(0);
  });

  test('mixed schedule keeps non-due inputs in an operable closed disclosure', async ({ page }) => {
    await openToday(page, withSchedule(['w', 'bp']));
    await expect(page.locator('#todayProgress')).toContainText('0 von 2 erfasst');
    await expect(page.locator('#todayDue #f_w')).toBeVisible();
    await expect(page.locator('#todayDue #f_sys1')).toBeVisible();
    await expect(page.locator('#todayDue #f_g')).toHaveCount(0);
    await expect(page.locator('#todayExtra #f_g')).toBeHidden();
    await expect(page.locator('#todayExtra #f_k')).toBeHidden();
    await expect(page.locator('#todayExtra #f_p')).toBeHidden();
    await page.locator('#todayExtraSummary').click();
    for (const field of ['#f_g', '#f_k', '#f_p']) await expect(page.locator(`#todayExtra ${field}`)).toBeVisible();
  });

  test('all-optional Today has a neutral no-due message and full access to measurements', async ({ page }) => {
    await openToday(page, withSchedule([]));
    await expect(page.locator('#todayProgress')).toHaveText('Laut deinem Messplan ist heute keine Messung vorgesehen.');
    await expect(page.locator('#todayDue [data-today-measurement]')).toHaveCount(0);
    await page.locator('#todayExtraSummary').click();
    for (const field of fields) await expect(page.locator(`#todayExtra ${field}`)).toBeVisible();
  });

  test('historical day retains the complete morning layout', async ({ page }) => {
    await openToday(page, withSchedule([]));
    await page.locator('[data-nav="-1"]').click();
    await expect(page.getByRole('heading', { name: 'Morgens, nüchtern' })).toBeVisible();
    for (const field of fields) await expect(page.locator(field)).toBeVisible();
    await expect(page.locator('#todayProgress,#todayExtra')).toHaveCount(0);
  });

  test('future in-period day retains the complete morning layout', async ({ page }) => {
    await openToday(page, withSchedule([]));
    await page.locator('[data-nav="1"]').click();
    await expect(page.getByRole('heading', { name: 'Morgens, nüchtern' })).toBeVisible();
    for (const field of fields) await expect(page.locator(field)).toBeVisible();
    await expect(page.locator('#todayProgress,#todayExtra')).toHaveCount(0);
  });

  test('Today outside the tracking period retains the complete morning layout', async ({ page }) => {
    await openToday(page, withSchedule([], { settings: { start: addDays(today(), -100), days: 7 } }));
    await expect(page.getByRole('heading', { name: 'Morgens, nüchtern' })).toBeVisible();
    for (const field of fields) await expect(page.locator(field)).toBeVisible();
    await expect(page.locator('#todayProgress,#todayExtra')).toHaveCount(0);
  });

  test('prefilled due value is compact with a German summary and original editable input', async ({ page }) => {
    await openToday(page, blankState({ days: { [today()]: { w: 82.4 } } }));
    const item = page.locator('[data-today-measurement="w"]');
    await expect(item.locator('details')).not.toHaveAttribute('open', '');
    await expect(item.locator('summary')).toContainText('Gewicht');
    await expect(item.locator('summary')).toContainText('82,4 kg');
    await expect(item.locator('#f_w')).toBeHidden();
    await item.locator('summary').click();
    await expect(item.locator('#f_w')).toBeVisible();
    await expect(item.locator('#f_w')).toHaveValue('82,4');
  });

  test('completed and extra disclosures open from the keyboard', async ({ page }) => {
    await openToday(page, withSchedule(['w'], { days: { [today()]: { w: 82 } } }));
    const complete = page.locator('[data-today-measurement="w"] details');
    await complete.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(complete).toHaveAttribute('open', '');
    await expect(complete.locator('#f_w')).toBeVisible();
    await page.locator('#todayExtraSummary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#todayExtra')).toHaveAttribute('open', '');
    await expect(page.locator('#todayExtra #f_g')).toBeVisible();
  });

  test('partial BP remains expanded; four source readings complete it with the derived summary', async ({ page }) => {
    await openToday(page, blankState({ days: { [today()]: { sys1: 128, dia1: 82, sys: 128, dia: 82 } } }));
    const item = page.locator('[data-today-measurement="bp"]');
    await expect(item.locator('details')).toHaveCount(0);
    await expect(item.locator('#f_sys1')).toBeVisible();
    await expect(page.locator('#todayProgress')).toContainText('0 von 5 erfasst');
    await page.locator('#f_sys2').fill('126');
    await page.locator('input[data-f="dia2"]').fill('78');
    await page.locator('input[data-f="dia2"]').blur();
    await expect(page.locator('#todayProgress')).toContainText('1 von 5 erfasst');
    await expect(item.locator('summary')).toContainText('127/80 mmHg');
  });

  test('simple due entry updates count live and compacts after focus leaves', async ({ page }) => {
    await openToday(page);
    await page.locator('#f_w').fill('82,4');
    await page.locator('#f_note').focus();
    await expect(page.locator('#todayProgress')).toContainText('1 von 5 erfasst');
    await expect(page.locator('[data-today-measurement="w"] summary')).toContainText('82,4 kg');
    await expect(page.locator('#f_note')).toBeFocused();
  });

  test('clearing an edited completed value returns it to full entry and decreases count', async ({ page }) => {
    await openToday(page, blankState({ days: { [today()]: { w: 82 } } }));
    const item = page.locator('[data-today-measurement="w"]');
    await item.locator('summary').click();
    await item.locator('#f_w').fill('');
    await page.locator('#f_note').focus();
    await expect(page.locator('#todayProgress')).toContainText('0 von 5 erfasst');
    await expect(item.locator('details')).toHaveCount(0);
    await expect(item.locator('#f_w')).toBeVisible();
  });

  test('editing a completed value refreshes its summary after blur', async ({ page }) => {
    await openToday(page, blankState({ days: { [today()]: { w: 82 } } }));
    const item = page.locator('[data-today-measurement="w"]');
    await item.locator('summary').click();
    await item.locator('#f_w').fill('83,2');
    await page.locator('#f_note').focus();
    await expect(item.locator('summary')).toContainText('83,2 kg');
    await expect(page.locator('#todayProgress')).toContainText('1 von 5 erfasst');
  });

  test('invalid edit keeps its input available for correction without changing stored data', async ({ page }) => {
    await openToday(page, blankState({ days: { [today()]: { w: 82 } } }));
    const item = page.locator('[data-today-measurement="w"]');
    await item.locator('summary').click();
    await item.locator('#f_w').fill('invalid');
    await page.locator('#f_note').focus();
    await expect(item.locator('#f_w')).toBeVisible();
    await expect(item.locator('#f_w')).toHaveValue('invalid');
    expect(await page.evaluate(() => S.days[today()].w)).toBe(82);
    await item.locator('#f_w').fill('83');
    await page.locator('#f_note').focus();
    await expect(item.locator('summary')).toContainText('83 kg');
  });

  test('completed BP keeps invalid sys1 after a valid dia1 edit and compacts once sys1 is corrected', async ({ page }) => {
    const day = { sys1: 130, dia1: 80, sys2: 126, dia2: 78, sys: 128, dia: 79 };
    await openToday(page, blankState({ days: { [today()]: day } }));
    const item = page.locator('[data-today-measurement="bp"]');
    await item.locator('summary').click();
    await item.locator('#f_sys1').fill('invalid');
    await item.locator('input[data-f="dia1"]').fill('84');
    await page.locator('#f_note').focus();
    await expect(item.locator('details')).toHaveAttribute('open', '');
    await expect(item.locator('#f_sys1')).toBeVisible();
    await expect(item.locator('#f_sys1')).toHaveValue('invalid');
    await expect(page.locator('#todayProgress')).toContainText('1 von 5 erfasst');
    expect(await page.evaluate(() => S.days[today()])).toMatchObject({ sys1: 130, dia1: 84, sys2: 126, dia2: 78 });

    await item.locator('#f_sys1').fill('132');
    await page.locator('#f_note').focus();
    await expect(item.locator('details')).not.toHaveAttribute('open', '');
    await expect(item.locator('summary')).toContainText('129/81 mmHg');
    expect(await page.evaluate(() => S.days[today()])).toMatchObject({ sys1: 132, dia1: 84, sys: 129, dia: 81 });
  });

  test('completed BP keeps invalid dia2 after a valid sys2 edit', async ({ page }) => {
    const day = { sys1: 130, dia1: 80, sys2: 126, dia2: 78, sys: 128, dia: 79 };
    await openToday(page, blankState({ days: { [today()]: day } }));
    const item = page.locator('[data-today-measurement="bp"]');
    await item.locator('summary').click();
    await item.locator('input[data-f="dia2"]').fill('invalid');
    await item.locator('#f_sys2').fill('134');
    await page.locator('#f_note').focus();
    await expect(item.locator('details')).toHaveAttribute('open', '');
    await expect(item.locator('input[data-f="dia2"]')).toHaveValue('invalid');
    expect(await page.evaluate(() => S.days[today()])).toMatchObject({ sys1: 130, dia1: 80, sys2: 134, dia2: 78 });

    await item.locator('input[data-f="dia2"]').fill('82');
    await page.locator('#f_note').focus();
    await expect(item.locator('details')).not.toHaveAttribute('open', '');
    await expect(item.locator('summary')).toContainText('132/81 mmHg');
  });

  test('BP focus survives all four fields without replacing its block', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openToday(page);
    const item = page.locator('[data-today-measurement="bp"]');
    await page.locator('#f_sys1').fill('128');
    await page.keyboard.press('Tab');
    await expect(page.locator('input[data-f="dia1"]')).toBeFocused();
    await expect(item.locator('details')).toHaveCount(0);
    await page.locator('input[data-f="dia1"]').fill('82');
    await page.keyboard.press('Tab');
    await expect(page.locator('#f_sys2')).toBeFocused();
    await expect(item.locator('details')).toHaveCount(0);
    await page.locator('#f_sys2').fill('126');
    await page.keyboard.press('Tab');
    await expect(page.locator('input[data-f="dia2"]')).toBeFocused();
    await expect(item.locator('details')).toHaveCount(0);
    await page.locator('input[data-f="dia2"]').fill('78');
    await expect(item.locator('input[data-f="dia2"]')).toBeFocused();
    await expect(page.locator('#todayProgress')).toContainText('0 von 5 erfasst');
    await page.keyboard.press('Tab');
    await expect(page.locator('#todayProgress')).toContainText('1 von 5 erfasst');
    await expect(item.locator('summary')).toContainText('127/80 mmHg');
    expect(errors).toEqual([]);
  });

  test('spontaneous non-due entry persists and stays out of scheduled completion', async ({ page }) => {
    await openToday(page, withSchedule(['w']));
    await page.locator('#todayExtraSummary').click();
    await page.locator('#f_g').fill('94');
    await page.locator('#f_g').blur();
    await expect(page.locator('#todayProgress')).toContainText('0 von 1 erfasst');
    await expect(page.locator('#todayExtraSummary')).toContainText('1 eingetragen');
    await page.reload();
    await expect(page.locator('#todayExtraSummary')).toContainText('1 eingetragen');
    await page.locator('#todayExtraSummary').click();
    await expect(page.locator('#f_g')).toHaveValue('94');
    expect(await page.evaluate(() => S.days[today()].g)).toBe(94);
  });

  test('extra summary counts measurements with data, including partial BP, once each', async ({ page }) => {
    await openToday(page, withSchedule(['w'], { days: { [today()]: { g: 94, sys1: 128, sys: 128 } } }));
    await expect(page.locator('#todayExtraSummary')).toContainText('2 eingetragen');
    await expect(page.locator('#todayProgress')).toContainText('0 von 1 erfasst');
  });

  test('medication is before daytime fields and does not affect the morning count', async ({ page }) => {
    const med = { id: 'synthetic-med', name: 'Testmed', dose: '10 mg', category: 'Medikament', startedAt: null, stoppedAt: null };
    await openToday(page, withSchedule(['w'], { settings: { meds: [med] } }));
    const headings = await page.locator('#v-day .panel h2').allTextContents();
    expect(headings.indexOf('Medikamente')).toBeLessThan(headings.indexOf('Über den Tag'));
    await page.locator('[data-med="synthetic-med"][data-mv="1"]').click();
    await expect(page.locator('#todayProgress')).toContainText('0 von 1 erfasst');
    expect(await page.evaluate(() => S.days[today()].meds['synthetic-med'])).toBe(true);
    await page.reload();
    await expect(page.locator('[data-med="synthetic-med"][data-mv="1"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('non-due glucose still triggers the doctor-agreed alert panel', async ({ page }) => {
    const alerts = { ...blankState().settings.alerts, gMax: 100, action: 'Synthetic agreed action' };
    await openToday(page, withSchedule(['w'], { settings: { alerts, alertHistory: [{ date: null, value: alerts }] } }));
    await page.locator('#todayExtraSummary').click();
    await page.locator('#f_g').fill('140');
    await page.locator('#f_g').blur();
    await expect(page.locator('#alertWarn')).toContainText('Außerhalb der mit dem Arzt vereinbarten Grenze');
    await expect(page.locator('#alertWarn')).toContainText('Synthetic agreed action');
    await expect(page.locator('#todayProgress')).toContainText('0 von 1 erfasst');
  });

  test('schedule presentation leaves existing day values and storage metadata unchanged', async ({ page }) => {
    const day = { w: 82, g: 94, k: 0.8, sys1: 128, dia1: 82, sys2: 126, dia2: 78, sys: 127, dia: 80, p: 61 };
    const state = withSchedule(['w'], { days: { [today()]: day }, settings: { lastBackup: '2026-09-01' } });
    await openToday(page, state);
    await page.locator('#todayExtraSummary').click();
    expect(await page.evaluate(() => ({ day: S.days[today()], stored: JSON.parse(localStorage.getItem(KEY)).days[today()],
      schema: S.dataVersion, lastBackup: S.settings.lastBackup, recovery: localStorage.getItem(RECOVERY_KEY) })))
      .toEqual({ day, stored: day, schema: 7, lastBackup: '2026-09-01', recovery: null });
  });

  test('Today navigation switches to full history and back to quick entry', async ({ page }) => {
    await openToday(page, withSchedule(['w']));
    await expect(page.locator('#todayDue')).toBeVisible();
    await page.locator('[data-nav="-1"]').click();
    await expect(page.locator('#todayDue')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Morgens, nüchtern' })).toBeVisible();
    await page.locator('[data-nav="0"]').click();
    await expect(page.locator('#todayDue')).toBeVisible();
    await expect(page.locator('#todayProgress')).toContainText('0 von 1 erfasst');
  });

  test('due, completed and extra controls have no duplicate IDs', async ({ page }) => {
    await openToday(page, withSchedule(['w', 'bp'], { days: { [today()]: { w: 82 } } }));
    await page.locator('[data-today-measurement="w"] summary').click();
    await page.locator('#todayExtraSummary').click();
    const idsOnPage = await page.locator('#v-day [id]').evaluateAll(nodes => nodes.map(n => n.id));
    expect(new Set(idsOnPage).size).toBe(idsOnPage.length);
    for (const field of fields) await expect(page.locator(field)).toHaveCount(1);
  });
});
