const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

// >=5 logged days is the threshold that gates the backup nudge/warning at all.
function sixLoggedDays() {
  const start = addDays(today(), -10);
  const days = {};
  for (let i = 0; i < 6; i++) days[addDays(start, i)] = { w: 80 };
  return days;
}

test.describe('Persistent storage status (Part A)', () => {
  test('Backup panel shows one of the three expected storage status lines', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    // checkStorage() resolves async at startup; wait for it rather than racing it.
    await page.waitForFunction(() => storageStatus !== null);
    await page.click('nav button[data-tab="set"]');

    const text = await page.locator('#storageLine').textContent();
    expect([
      'Speicher: dauerhaft geschützt',
      'Speicher: nicht dauerhaft geschützt — regelmäßige Backups besonders wichtig',
      'Speicher-Schutz vom Browser nicht unterstützt',
    ]).toContain(text);
  });
});

test.describe('Backup reminder escalation (Part B)', () => {
  test('7 days without backup shows the subtle header nudge, not the warning panel', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: addDays(today(), -7), meds: [] },
      days: sixLoggedDays(),
    }));
    await page.click('nav button[data-tab="day"]');

    await expect(page.locator('#nudge')).toBeVisible();
    await expect(page.locator('#nudge')).toContainText('Letztes Backup vor 7 Tagen');
    await expect(page.locator('#backupWarn')).toHaveCount(0);
  });

  test('14 days without backup shows the warning panel on Heute instead of the header nudge', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: addDays(today(), -14), meds: [] },
      days: sixLoggedDays(),
    }));
    await page.click('nav button[data-tab="day"]');

    await expect(page.locator('#nudge')).toBeHidden();
    await expect(page.locator('#backupWarn')).toBeVisible();
    await expect(page.locator('#backupWarn')).toContainText('Letztes Backup vor 14 Tagen');
  });

  test('never having backed up also escalates straight to the warning panel', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      days: sixLoggedDays(),
    }));
    await page.click('nav button[data-tab="day"]');

    await expect(page.locator('#backupWarn')).toBeVisible();
    await expect(page.locator('#backupWarn')).toContainText('Noch kein Backup gemacht');
  });

  test('"Jetzt sichern" on the warning panel exports directly and clears the panel', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: addDays(today(), -14), meds: [] },
      days: sixLoggedDays(),
    }));
    await page.click('nav button[data-tab="day"]');
    await expect(page.locator('#backupWarn')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#backupWarnExp'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^keto-protokoll-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.locator('#backupWarn')).toHaveCount(0);
    const lastBackup = await page.evaluate(() => S.settings.lastBackup);
    expect(lastBackup).toBe(today());
  });

  test('dismissing the warning panel hides it only for the current day', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: addDays(today(), -14), meds: [] },
      days: sixLoggedDays(),
    }));
    await page.click('nav button[data-tab="day"]');
    await expect(page.locator('#backupWarn')).toBeVisible();

    await page.click('#backupWarnDismiss');
    await expect(page.locator('#backupWarn')).toHaveCount(0);
    const dismissed = await page.evaluate(() => S.settings.backupWarnDismissed);
    expect(dismissed).toBe(today());

    // Still today: reloading keeps the dismissal in effect.
    await page.reload();
    await page.click('nav button[data-tab="day"]');
    await expect(page.locator('#backupWarn')).toHaveCount(0);

    // Simulate the dismissal having been recorded on a prior day: it must not carry over.
    await page.evaluate(() => { S.settings.backupWarnDismissed = addDays(today(), -1); save(); });
    await page.reload();
    await page.click('nav button[data-tab="day"]');
    await expect(page.locator('#backupWarn')).toBeVisible();
  });
});

test.describe('Single migration path (Part C)', () => {
  test('migrate() upgrades a minimal version-0 backup to the full current shape', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => migrate({ settings: { start: '2026-01-01' } }));

    expect(result.dataVersion).toBe(2);
    expect(result.settings.meds).toEqual([]);
    expect(result.settings.lastBackup).toBeNull();
    expect(result.settings.backupWarnDismissed).toBeNull();
    expect(result.settings.days).toBe(90);
    expect(result.settings.carbGoal).toBe(50);
    expect(result.days).toEqual({});
    expect(result.weeks).toEqual({});
    expect(Array.isArray(result.labs)).toBe(true);
    expect(result.labs.length).toBeGreaterThan(0);
    expect(result.labs.every((r) => r.range === '')).toBe(true);
    expect(result.labDates).toEqual({ base: expect.any(String), end: '' });
    expect(result.doseChanges).toEqual([]);
    expect(result.archive).toEqual([]);
    expect(result.refRead).toEqual({});
  });

  test('migrate() fills gaps in a partial version-0 object without touching present fields', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => migrate({
      settings: { name: 'Test Patient', start: '2026-01-01', days: 30, carbGoal: 40, meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
      days: { '2026-01-01': { w: 80 } },
      labs: [{ name: 'HbA1c', unit: '%', range: null, base: '', end: '' }],
    }));

    expect(result.dataVersion).toBe(2);
    expect(result.settings.name).toBe('Test Patient');
    expect(result.settings.meds).toEqual([{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }]);
    expect(result.days).toEqual({ '2026-01-01': { w: 80 } });
    expect(result.labs[0].range).toBe(''); // null range normalized, rest of the row untouched
    expect(result.weeks).toEqual({});
    expect(result.archive).toEqual([]);
  });

  test('load() runs a backup missing every post-launch field through migrate() and stamps dataVersion', async ({ page }) => {
    await gotoApp(page);
    const oldBackup = {
      settings: { name: 'Test Patient', start: '2026-01-01', days: 90, carbGoal: 50, questions: '', lastBackup: null },
      days: { '2026-01-01': { w: 80 } },
    };
    await page.evaluate((d) => localStorage.setItem('ketoProtokoll_v1', JSON.stringify(d)), oldBackup);
    await page.reload();

    const state = await page.evaluate(() => ({
      dataVersion: S.dataVersion, meds: S.settings.meds, doseChanges: S.doseChanges,
      archive: S.archive, refRead: S.refRead, weeks: S.weeks, labsCount: S.labs.length,
    }));
    expect(state.dataVersion).toBe(2);
    expect(state.meds).toEqual([]);
    expect(state.doseChanges).toEqual([]);
    expect(state.archive).toEqual([]);
    expect(state.refRead).toEqual({});
    expect(state.weeks).toEqual({});
    expect(state.labsCount).toBeGreaterThan(0); // no labs in the old backup at all -> defaults to DEFAULT_LABS
  });

  test('importing a backup with a newer dataVersion than the app is rejected with a clear message', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: 'Current', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
    }));
    await page.click('nav button[data-tab="set"]');

    const newerBackup = JSON.stringify({
      dataVersion: 999,
      settings: { name: 'From The Future', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      days: {},
    });
    await page.setInputFiles('#importFile', { name: 'newer-backup.json', mimeType: 'application/json', buffer: Buffer.from(newerBackup) });

    await expect(page.locator('#status')).toHaveText(/neueren App-Version/);
    const name = await page.evaluate(() => S.settings.name);
    expect(name).toBe('Current'); // rejected import never replaced the live state
  });

  test('importing a backup with the current dataVersion is accepted', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: 'Current', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
    }));
    await page.click('nav button[data-tab="set"]');

    const sameVersionBackup = JSON.stringify({
      dataVersion: 2,
      settings: { name: 'Imported Patient', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      days: {},
    });
    page.once('dialog', (d) => d.accept());
    await page.setInputFiles('#importFile', { name: 'same-version-backup.json', mimeType: 'application/json', buffer: Buffer.from(sameVersionBackup) });

    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Imported Patient');
  });
});
