const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const ids = ['w', 'g', 'k', 'bp', 'p'];
const allDaily = () => Object.fromEntries(ids.map(id => [id, { mode: 'daily', weekdays: [] }]));
const scheduleState = (schedule, overrides = {}) => blankState({
  ...overrides,
  settings: { ...blankState().settings, ...overrides.settings, measurementSchedule: schedule },
});
async function openSettings(page, state = blankState()) {
  await gotoApp(page);
  await seed(page, state);
  await page.click('nav button[data-tab="set"]');
}
async function importFile(page, data) {
  await page.setInputFiles('#importFile', {
    name: 'synthetic-schedule-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
}

test.describe('Measurement schedule foundation', () => {
  test('factory returns exactly five detached all-daily entries', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => {
      const first = defaultMeasurementSchedule(), second = defaultMeasurementSchedule();
      first.w.weekdays.push(1);
      return { first, second, differentEntries: first.w !== first.g && first.w !== second.w,
        differentArrays: first.w.weekdays !== first.g.weekdays && first.w.weekdays !== second.w.weekdays };
    });
    expect(Object.keys(result.second)).toEqual(ids);
    expect(result.second).toEqual(allDaily());
    expect(result.first.g).toEqual({ mode: 'daily', weekdays: [] });
    expect(result.differentEntries).toBe(true);
    expect(result.differentArrays).toBe(true);
  });

  test('v5 load adds all-daily defaults without changing recorded data', async ({ page }) => {
    const legacy = blankState({ dataVersion: 5, days: { [today()]: { w: 80, g: 95, sys1: 128, dia1: 82, sys: 128, dia: 82 } } });
    delete legacy.settings.measurementSchedule;
    await gotoApp(page);
    await seed(page, legacy);
    const result = await page.evaluate(() => ({ version: S.dataVersion, schedule: S.settings.measurementSchedule,
      days: S.days, idempotent: (() => { const before = JSON.stringify(S); migrate(S); return JSON.stringify(S) === before; })() }));
    expect(result).toEqual({ version: 7, schedule: allDaily(), days: legacy.days, idempotent: true });
  });

  test('a current v6 schedule survives the real load path unchanged', async ({ page }) => {
    const schedule = allDaily();
    schedule.g = { mode: 'optional', weekdays: [] };
    schedule.bp = { mode: 'weekdays', weekdays: [1, 7] };
    await gotoApp(page);
    await seed(page, scheduleState(schedule));
    expect(await page.evaluate(() => ({ version: S.dataVersion, schedule: S.settings.measurementSchedule })))
      .toEqual({ version: 7, schedule });
  });

  test('a v5 backup without a schedule imports as v6 with all-daily defaults', async ({ page }) => {
    await openSettings(page);
    const legacy = blankState({ dataVersion: 5, settings: { ...blankState().settings, name: 'Synthetic legacy profile' },
      days: { [today()]: { k: 0.8 } } });
    delete legacy.settings.measurementSchedule;
    page.once('dialog', dialog => dialog.accept());
    await importFile(page, legacy);
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Synthetic legacy profile');
    expect(await page.evaluate(() => ({ version: S.dataVersion, schedule: S.settings.measurementSchedule,
      ketones: S.days[today()].k }))).toEqual({ version: 7, schedule: allDaily(), ketones: 0.8 });
  });

  test('malformed v6 schedules are rejected before confirmation or replacement', async ({ page }) => {
    await openSettings(page, blankState({ settings: { ...blankState().settings, name: 'Original synthetic profile' } }));
    const before = await page.evaluate(() => ({ state: JSON.stringify(S), stored: localStorage.getItem(KEY) }));
    let confirmations = 0;
    page.on('dialog', dialog => { confirmations++; return dialog.dismiss(); });
    const invalid = [[], { ...allDaily(), p: undefined }, { ...allDaily(), w: { mode: 'unknown', weekdays: [] } },
      { ...allDaily(), w: { mode: 'weekdays', weekdays: [0] } },
      { ...allDaily(), w: { mode: 'weekdays', weekdays: [8] } },
      { ...allDaily(), w: { mode: 'weekdays', weekdays: [1, 1] } },
      { ...allDaily(), w: { mode: 'weekdays', weekdays: [] } },
      { ...allDaily(), w: { mode: 'daily', weekdays: [1] } },
      { ...allDaily(), extra: { mode: 'daily', weekdays: [] } }];
    for (const schedule of invalid) {
      await importFile(page, scheduleState(schedule));
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await page.evaluate(() => ({ state: JSON.stringify(S), stored: localStorage.getItem(KEY),
        recovery: localStorage.getItem(RECOVERY_KEY) }))).toEqual({ ...before, recovery: null });
    }
    expect(confirmations).toBe(0);
  });

  test('malformed recovery schedules are not offered or restored', async ({ page }) => {
    await openSettings(page);
    const invalid = scheduleState({ ...allDaily(), bp: { mode: 'weekdays', weekdays: [] } });
    const before = await page.evaluate(() => JSON.stringify(S));
    await page.evaluate(data => {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({ createdAt: new Date().toISOString(), data }));
      renderSet();
    }, invalid);
    await expect(page.locator('#restoreRecovery')).toHaveCount(0);
    await page.evaluate(() => restoreRecovery());
    expect(await page.evaluate(() => JSON.stringify(S))).toBe(before);
  });

  test('a malformed local schedule cannot crash Settings and is repaired on edit', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openSettings(page, scheduleState([]));
    await expect(page.locator('#ms_w')).toHaveValue('daily');
    await page.locator('#ms_w').selectOption('weekdays');
    const schedule = await page.evaluate(() => S.settings.measurementSchedule);
    expect(Object.keys(schedule)).toEqual(ids);
    expect(schedule.w).toEqual({ mode: 'weekdays', weekdays: [await page.evaluate(() => isoWeekday(today()))] });
    expect(errors).toEqual([]);
  });

  test('due lookups use local ISO weekdays and current period boundaries', async ({ page }) => {
    const schedule = allDaily();
    schedule.g = { mode: 'optional', weekdays: [] };
    schedule.k = { mode: 'weekdays', weekdays: [1, 7] };
    schedule.bp = { mode: 'weekdays', weekdays: [7] };
    await gotoApp(page);
    await seed(page, scheduleState(schedule, { settings: { start: '2026-09-21', days: 7 } }));
    const result = await page.evaluate(() => ({
      monday: dueMeasurementIds('2026-09-21'), sunday: dueMeasurementIds('2026-09-27'),
      tuesday: dueMeasurementIds('2026-09-22'), before: dueMeasurementIds('2026-09-20'),
      after: dueMeasurementIds('2026-09-28'), invalid: isMeasurementDue('w', '2026-02-31'),
      unknown: isMeasurementDue('unknown', '2026-09-21'), optional: isMeasurementDue('g', '2026-09-21'),
    }));
    expect(result).toEqual({ monday: ['w', 'k', 'p'], sunday: ['w', 'k', 'bp', 'p'],
      tuesday: ['w', 'p'], before: [], after: [], invalid: false, unknown: false, optional: false });
  });

  test('Settings renders five labeled schedule choices and accessible weekday buttons', async ({ page }) => {
    const schedule = allDaily();
    schedule.w = { mode: 'weekdays', weekdays: [1] };
    await openSettings(page, scheduleState(schedule));
    for (const id of ids) await expect(page.locator(`#ms_${id}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gewicht, Montag' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Gewicht, Dienstag' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#v-set')).toContainText('Du kannst Werte trotzdem jederzeit eintragen');
  });

  test('daily to weekdays starts with today only and persists without changing backup state', async ({ page }) => {
    const state = blankState({ settings: { ...blankState().settings, lastBackup: '2026-09-01' },
      days: { [today()]: { w: 80, g: 95, note: 'Synthetic note' } } });
    await openSettings(page, state);
    await page.locator('#ms_w').selectOption('weekdays');
    const expected = await page.evaluate(() => ({ mode: 'weekdays', weekdays: [isoWeekday(today())] }));
    expect(await page.evaluate(() => ({ entry: S.settings.measurementSchedule.w,
      stored: JSON.parse(localStorage.getItem(KEY)).settings.measurementSchedule.w,
      days: S.days, lastBackup: S.settings.lastBackup, recovery: localStorage.getItem(RECOVERY_KEY) })))
      .toEqual({ entry: expected, stored: expected, days: state.days, lastBackup: '2026-09-01', recovery: null });
    await page.reload();
    await page.click('nav button[data-tab="set"]');
    await expect(page.locator('#ms_w')).toHaveValue('weekdays');
    expect(await page.evaluate(() => S.settings.measurementSchedule.w)).toEqual(expected);
  });

  test('weekday toggles stay sorted, unique, and persisted; the final day cannot be removed', async ({ page }) => {
    await openSettings(page);
    await page.locator('#ms_g').selectOption('weekdays');
    const first = await page.evaluate(() => isoWeekday(today()));
    const other = first === 7 ? 1 : first + 1;
    await page.locator(`[data-ms-id="g"][data-ms-day="${other}"]`).click();
    const both = [first, other].sort((a, b) => a - b);
    expect(await page.evaluate(() => S.settings.measurementSchedule.g.weekdays)).toEqual(both);
    await page.reload();
    await page.click('nav button[data-tab="set"]');
    expect(await page.evaluate(() => S.settings.measurementSchedule.g.weekdays)).toEqual(both);
    await page.locator(`[data-ms-id="g"][data-ms-day="${other}"]`).click();
    expect(await page.evaluate(() => S.settings.measurementSchedule.g.weekdays)).toEqual([first]);
    await page.locator(`[data-ms-id="g"][data-ms-day="${first}"]`).click();
    await expect(page.locator('#status')).toContainText('Mindestens einen Wochentag auswählen');
    expect(await page.evaluate(() => ({ live: S.settings.measurementSchedule.g.weekdays,
      stored: JSON.parse(localStorage.getItem(KEY)).settings.measurementSchedule.g.weekdays })))
      .toEqual({ live: [first], stored: [first] });
  });

  test('weekdays to optional and optional to daily clear selected weekdays', async ({ page }) => {
    await openSettings(page);
    await page.locator('#ms_bp').selectOption('weekdays');
    await page.locator('#ms_bp').selectOption('optional');
    expect(await page.evaluate(() => S.settings.measurementSchedule.bp)).toEqual({ mode: 'optional', weekdays: [] });
    await page.locator('#ms_bp').selectOption('daily');
    expect(await page.evaluate(() => S.settings.measurementSchedule.bp)).toEqual({ mode: 'daily', weekdays: [] });
  });

  test('new round carries a detached schedule and older archived settings migrate', async ({ page }) => {
    const schedule = allDaily();
    schedule.p = { mode: 'optional', weekdays: [] };
    schedule.bp = { mode: 'weekdays', weekdays: [1, 7] };
    const old = blankState({ dataVersion: 5, settings: { ...blankState().settings, start: '2026-01-01' } });
    delete old.settings.measurementSchedule;
    await openSettings(page, scheduleState(schedule, { settings: { start: addDays(today(), -30), days: 30 },
      archive: [{ label: 'Synthetic old round', archivedAt: '2026-02-01', data: old }] }));
    expect(await page.evaluate(() => S.archive[0].data.settings.measurementSchedule)).toEqual(allDaily());
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#newRound').click();
    expect(await page.evaluate(() => ({ live: S.settings.measurementSchedule,
      archived: S.archive.at(-1).data.settings.measurementSchedule,
      detached: S.settings.measurementSchedule !== S.archive.at(-1).data.settings.measurementSchedule })))
      .toEqual({ live: schedule, archived: schedule, detached: true });
    await page.locator('#ms_p').selectOption('daily');
    expect(await page.evaluate(() => S.archive.at(-1).data.settings.measurementSchedule.p))
      .toEqual({ mode: 'optional', weekdays: [] });
  });

  test('Today keeps all optional morning controls accessible under Weitere Werte', async ({ page }) => {
    const optional = Object.fromEntries(ids.map(id => [id, { mode: 'optional', weekdays: [] }]));
    await gotoApp(page);
    await seed(page, scheduleState(optional));
    expect(await page.evaluate(() => dueMeasurementIds(today()))).toEqual([]);
    await expect(page.locator('#todayExtraSummary')).toContainText('Weitere Werte eintragen');
    for (const selector of ['#f_w', '#f_g', '#f_k', '#f_sys1', '#f_sys2', '#f_p'])
      await expect(page.locator(`#todayExtra ${selector}`)).toBeHidden();
    await page.locator('#todayExtraSummary').click();
    for (const selector of ['#f_w', '#f_g', '#f_k', '#f_sys1', '#f_sys2', '#f_p'])
      await expect(page.locator(`#todayExtra ${selector}`)).toBeVisible();
  });
});
