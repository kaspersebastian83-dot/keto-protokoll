const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

test.describe('Backup export/import', () => {
  test('exported JSON round-trips back into an equivalent live state via the real import handler', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { name: 'Test Patient', start: today(), days: 90, carbGoal: 45, questions: 'Testfrage?', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
      days: { [today()]: { w: 80, g: 95 } },
    });
    await seed(page, state);

    // Serialize exactly what the export button would write, without touching the filesystem.
    const exported = await page.evaluate(() => JSON.stringify(S, null, 1));

    // Reset to a blank state, then import that JSON through the actual UI file
    // input and its migrate()-based handler — not a re-implementation of it.
    await seed(page, blankState());
    await page.click('nav button[data-tab="set"]');
    page.once('dialog', (d) => d.accept());
    await page.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(exported) });

    const restored = await page.evaluate(() => ({ name: S.settings.name, meds: S.settings.meds, days: S.days }));
    expect(restored.name).toBe('Test Patient');
    expect(restored.meds).toEqual([{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }]);
    expect(restored.days[today()]).toEqual({ w: 80, g: 95 });
  });

  test('an old backup missing newer fields migrates cleanly through the real import handler', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="set"]');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Simulates a backup saved before meds/doseChanges/archive/refRead/labs[].range/dataVersion existed.
    const oldBackup = JSON.stringify({
      settings: { name: 'Test Patient', start: '2026-01-01', days: 90, carbGoal: 50, questions: '', lastBackup: null },
      days: { '2026-01-01': { w: 80 } },
    });
    page.once('dialog', (d) => d.accept());
    await page.setInputFiles('#importFile', { name: 'old-backup.json', mimeType: 'application/json', buffer: Buffer.from(oldBackup) });

    const migrated = await page.evaluate(() => ({
      dataVersion: S.dataVersion, weeks: S.weeks, labDates: S.labDates, meds: S.settings.meds,
      doseChanges: S.doseChanges, archive: S.archive, refRead: S.refRead,
      carbGoalHistory: S.settings.carbGoalHistory, alertHistory: S.settings.alertHistory,
    }));

    expect(migrated).toEqual({
      dataVersion: 5, weeks: {}, labDates: { base: expect.any(String), end: '' }, meds: [],
      doseChanges: [], archive: [], refRead: {},
      carbGoalHistory: [{ date: null, value: 50 }],
      alertHistory: [{ date: null, value: blankState().settings.alerts }],
    });
    expect(errors).toEqual([]);
  });

  test('importing a v5 backup synchronizes stale live scalars without changing histories', async ({ page }) => {
    await gotoApp(page);
    const currentAlerts = { ...blankState().settings.alerts, gMax: 160, action: 'Current synthetic action' };
    const goalHistory = [{ date: null, value: 50 }, { date: '2026-09-20', value: 30 }];
    const alertHistory = [
      { date: null, value: { ...blankState().settings.alerts, gMax: 180 } },
      { date: '2026-09-20', value: currentAlerts },
    ];
    const backup = blankState({ settings: {
      ...blankState().settings, carbGoal: 99,
      alerts: { ...blankState().settings.alerts, gMax: 999, action: 'Stale action' },
      carbGoalHistory: goalHistory, alertHistory,
    } });
    await seed(page, blankState());
    await page.click('nav button[data-tab="set"]');
    page.once('dialog', (d) => d.accept());
    await page.setInputFiles('#importFile', {
      name: 'stale-v5-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect.poll(() => page.evaluate(() => S.settings.carbGoal)).toBe(30);
    const result = await page.evaluate(() => ({
      goal: S.settings.carbGoal, alerts: S.settings.alerts,
      goalHistory: S.settings.carbGoalHistory, alertHistory: S.settings.alertHistory,
      detached: S.settings.alerts !== S.settings.alertHistory.at(-1).value,
      savedGoal: JSON.parse(localStorage.getItem('ketoProtokoll_v1')).settings.carbGoal,
    }));
    expect(result).toEqual({
      goal: 30, alerts: currentAlerts, goalHistory, alertHistory, detached: true, savedGoal: 30,
    });
  });
});
