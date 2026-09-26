const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const liveState = () => blankState({
  settings: { ...blankState().settings, name: 'Live synthetic profile', lastBackup: '2026-09-01' },
  days: { [today()]: { w: 80 } },
});
const importedState = () => {
  const currentAlerts = { ...blankState().settings.alerts, gMax: 160, action: 'Current synthetic action' };
  return blankState({
    settings: { ...blankState().settings, name: 'Imported synthetic profile', start: '2026-09-01',
      carbGoal: 99, alerts: { ...currentAlerts, gMax: 999 },
      carbGoalHistory: [{ date: null, value: 50 }, { date: '2026-09-20', value: 30 }],
      alertHistory: [{ date: null, value: { ...currentAlerts, gMax: 180 } }, { date: '2026-09-20', value: currentAlerts }] },
    days: { [addDays(today(), -1)]: { w: 79 }, [today()]: { g: 95 } },
    archive: [{ label: 'Synthetic archive', archivedAt: '2026-09-01', data: blankState() }],
  });
};
const syntheticMed = () => ({
  id: 'medA', name: 'Synthetic medication', dose: '10 mg', category: 'Medikament',
  startedAt: '2026-09-01', stoppedAt: '2026-09-20',
});
async function setup(page) {
  await gotoApp(page);
  await seed(page, liveState());
  await page.click('nav button[data-tab="set"]');
  return snapshot(page);
}
async function snapshot(page) {
  return page.evaluate(() => ({
    state: JSON.stringify(S), stored: localStorage.getItem(KEY),
    recovery: localStorage.getItem(RECOVERY_KEY),
  }));
}
async function importText(page, content, name = 'synthetic-backup.json') {
  await page.setInputFiles('#importFile', {
    name, mimeType: 'application/json', buffer: Buffer.from(content),
  });
  await expect(page.locator('#importFile')).toHaveValue('');
}
async function importAccepted(page, data = importedState()) {
  page.once('dialog', dialog => dialog.accept());
  await importText(page, JSON.stringify(data));
  await expect.poll(() => page.evaluate(() => S.settings.name)).toBe(data.settings.name);
}

test.describe('Safe backup import and local recovery', () => {
  test('invalid JSON leaves live data untouched, creates no recovery, and resets the file input', async ({ page }) => {
    const before = await setup(page);
    await importText(page, '{broken json');
    await expect(page.locator('#status')).toContainText('kein gültiges JSON-Backup');
    expect(await snapshot(page)).toEqual(before);
  });

  test('root, settings, and days arrays are rejected without touching live data', async ({ page }) => {
    const before = await setup(page);
    for (const invalid of [[], { settings: [], days: {} }, { settings: {}, days: [] }]) {
      await importText(page, JSON.stringify(invalid));
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await snapshot(page)).toEqual(before);
    }
  });

  test('an incomplete v5 state cannot replace live data after preparation', async ({ page }) => {
    const before = await setup(page);
    await importText(page, JSON.stringify({ dataVersion: 5, settings: { name: 'Incomplete', start: today() }, days: {} }));
    await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
    expect(await snapshot(page)).toEqual(before);
  });

  test('an archive without a usable display date is rejected before replacing live data', async ({ page }) => {
    const before = await setup(page);
    const invalid = importedState();
    invalid.archive[0].archivedAt = 'not-a-date';
    await importText(page, JSON.stringify(invalid));
    await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
    expect(await snapshot(page)).toEqual(before);
  });

  test('invalid medication lifecycle dates are rejected before confirmation or recovery', async ({ page }) => {
    const before = await setup(page);
    const errors = [];
    let confirmations = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { confirmations++; return dialog.dismiss(); });
    for (const field of ['startedAt', 'stoppedAt']) {
      const invalid = importedState();
      invalid.settings.meds = [{ ...syntheticMed(), [field]: {} }];
      await importText(page, JSON.stringify(invalid));
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await snapshot(page)).toEqual(before);
    }
    const reversed = importedState();
    reversed.settings.meds = [{ ...syntheticMed(), stoppedAt: '2026-08-31' }];
    await importText(page, JSON.stringify(reversed));
    await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
    expect(await snapshot(page)).toEqual(before);
    expect(confirmations).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a medication with two valid lifecycle dates remains importable', async ({ page }) => {
    await setup(page);
    const backup = importedState();
    backup.settings.meds = [syntheticMed()];
    await importAccepted(page, backup);
    expect(await page.evaluate(() => S.settings.meds[0])).toEqual(syntheticMed());
  });

  test('malformed backup and lab dates or symptom containers are rejected before replacement', async ({ page }) => {
    const before = await setup(page);
    for (const change of [
      data => { data.settings.lastBackup = {}; },
      data => { data.labDates.base = {}; },
      data => { data.days[today()].sym = {}; },
    ]) {
      const invalid = importedState();
      change(invalid);
      await importText(page, JSON.stringify(invalid));
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await snapshot(page)).toEqual(before);
    }
  });

  test('future data version is rejected without recovery or live changes', async ({ page }) => {
    const before = await setup(page);
    await importText(page, JSON.stringify({ dataVersion: 999, settings: {}, days: {} }));
    await expect(page.locator('#status')).toContainText('neueren App-Version');
    expect(await snapshot(page)).toEqual(before);
  });

  test('a failed migration leaves the live state and key unchanged', async ({ page }) => {
    const before = await setup(page);
    await importText(page, JSON.stringify({ settings: { start: '2026-01-01' }, days: {}, labs: [null] }));
    await expect(page.locator('#status')).toContainText('konnte nicht verarbeitet werden');
    expect(await snapshot(page)).toEqual(before);
  });

  test('cancelled confirmation preserves S, the live key, and the absent recovery key', async ({ page }) => {
    const before = await setup(page);
    page.once('dialog', dialog => dialog.dismiss());
    await importText(page, JSON.stringify(importedState()));
    expect(await snapshot(page)).toEqual(before);
  });

  test('confirmed import summarizes the backup, saves synced data, and keeps an exact prior-state recovery', async ({ page }) => {
    const before = await setup(page);
    let confirmation = '';
    page.once('dialog', dialog => { confirmation = dialog.message(); return dialog.accept(); });
    await importText(page, JSON.stringify(importedState()));
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Imported synthetic profile');
    expect(confirmation).toContain('Imported synthetic profile');
    expect(confirmation).toContain('2026-09-01');
    expect(confirmation).toContain('Erfasste Tage: 2');
    expect(confirmation).toContain('Archivierte Durchgänge: 1');
    expect(confirmation).toContain('Datenversion: 7');
    expect(confirmation).toContain('aktuellen Browserdaten werden ersetzt');
    expect(confirmation).toContain('lokale Sicherheitskopie');
    const result = await page.evaluate(() => ({
      state: S, stored: JSON.parse(localStorage.getItem(KEY)),
      recovery: JSON.parse(localStorage.getItem(RECOVERY_KEY)),
      detached: S.settings.alerts !== S.settings.alertHistory.at(-1).value,
    }));
    expect(result.state.settings.carbGoal).toBe(30);
    expect(result.state.settings.alerts.gMax).toBe(160);
    expect(result.detached).toBe(true);
    expect(result.stored).toEqual(result.state);
    expect(result.recovery.data).toEqual(JSON.parse(before.state));
    expect(Number.isFinite(Date.parse(result.recovery.createdAt))).toBe(true);
    await expect(page.locator('#restoreRecovery')).toBeVisible();
    await expect(page.locator('#deleteRecovery')).toBeVisible();
    await expect(page.locator('#v-set')).toContainText('Lokale Sicherheitskopie vor dem letzten Backup-Laden');
  });

  test('restoring recovery replaces live data and removes recovery only after persistence', async ({ page }) => {
    const before = await setup(page);
    await importAccepted(page);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#restoreRecovery');
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Live synthetic profile');
    const after = await snapshot(page);
    expect(after.state).toBe(before.state);
    expect(after.stored).toBe(before.state);
    expect(after.recovery).toBeNull();
    await expect(page.locator('#restoreRecovery')).toHaveCount(0);
  });

  test('future and malformed recovery data are not offered as restorable', async ({ page }) => {
    const before = await setup(page);
    const badMedication = importedState();
    badMedication.settings.meds = [{ ...syntheticMed(), stoppedAt: {} }];
    const values = [
      'bad json', '[]', JSON.stringify({ createdAt: 'x', data: null }),
      JSON.stringify({ createdAt: new Date().toISOString(), data: { ...importedState(), dataVersion: 999 } }),
      JSON.stringify({ createdAt: new Date().toISOString(), data: badMedication }),
    ];
    for (const value of values) {
      const result = await page.evaluate(raw => {
        localStorage.setItem(RECOVERY_KEY, raw);
        renderSet();
        return { state: JSON.stringify(S), stored: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY) };
      }, value);
      expect(result).toEqual({ state: before.state, stored: before.stored, recovery: value });
      await expect(page.locator('#restoreRecovery')).toHaveCount(0);
    }
  });

  test('valid legacy recovery is offered and restored without rewriting its stored wrapper first', async ({ page }) => {
    await setup(page);
    const legacy = importedState();
    legacy.dataVersion = 3;
    legacy.settings.meds = [{ id: 'medA', name: 'Synthetic medication', dose: '10 mg', category: 'Medikament' }];
    delete legacy.settings.carbGoalHistory;
    delete legacy.settings.alertHistory;
    const wrapper = JSON.stringify({ createdAt: new Date().toISOString(), data: legacy });
    await page.evaluate(raw => { localStorage.setItem(RECOVERY_KEY, raw); renderSet(); }, wrapper);
    await expect(page.locator('#restoreRecovery')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem(RECOVERY_KEY))).toBe(wrapper);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#restoreRecovery');
    expect(await page.evaluate(() => ({ name: S.settings.name, version: S.dataVersion, med: S.settings.meds[0], recovery: localStorage.getItem(RECOVERY_KEY) }))).toEqual({
      name: legacy.settings.name, version: 7,
      med: { ...legacy.settings.meds[0], startedAt: null, stoppedAt: null }, recovery: null,
    });
  });

  test('deleting recovery removes only its key', async ({ page }) => {
    await setup(page);
    await importAccepted(page);
    const imported = await snapshot(page);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#deleteRecovery');
    const after = await snapshot(page);
    expect(after.state).toBe(imported.state);
    expect(after.stored).toBe(imported.stored);
    expect(after.recovery).toBeNull();
  });

  test('normal JSON export updates lastBackup without exporting or changing recovery', async ({ page }) => {
    await setup(page);
    await importAccepted(page);
    const recoveryBefore = await page.evaluate(() => localStorage.getItem(RECOVERY_KEY));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exp')]);
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    expect(exported.settings.lastBackup).toBe(today());
    expect(exported).not.toHaveProperty('recovery');
    expect(exported).not.toHaveProperty('createdAt');
    expect(await page.evaluate(() => localStorage.getItem(RECOVERY_KEY))).toBe(recoveryBefore);
  });

  test('reset clears both keys and creates a clean empty live state', async ({ page }) => {
    await setup(page);
    await importAccepted(page);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#reset');
    const result = await page.evaluate(() => ({
      live: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY),
      name: S.settings.name, days: S.days, dataVersion: S.dataVersion,
    }));
    expect(result).toEqual({ live: null, recovery: null, name: '', days: {}, dataVersion: 7 });
  });

  test('recovery-write failure aborts import before replacing S or the live key', async ({ page }) => {
    const before = await setup(page);
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === RECOVERY_KEY) throw new Error('Synthetic recovery quota failure');
        return window.originalSetItem.call(this, key, value);
      };
    });
    page.once('dialog', dialog => dialog.accept());
    await importText(page, JSON.stringify(importedState()));
    await expect(page.locator('#status')).toContainText('Sicherheitskopie konnte nicht erstellt werden');
    expect(await snapshot(page)).toEqual(before);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  });

  test('import persistence failure restores the exact live reference and retains recovery', async ({ page }) => {
    const before = await setup(page);
    await page.evaluate(() => {
      window.originalLive = S;
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === KEY) throw new Error('Synthetic live quota failure');
        return window.originalSetItem.call(this, key, value);
      };
    });
    page.once('dialog', dialog => dialog.accept());
    await importText(page, JSON.stringify(importedState()));
    await expect(page.locator('#status')).toContainText('Backup konnte nicht gespeichert werden');
    const after = await page.evaluate(() => ({
      sameReference: S === window.originalLive,
      state: JSON.stringify(S), stored: localStorage.getItem(KEY), recovery: JSON.parse(localStorage.getItem(RECOVERY_KEY)),
    }));
    expect(after.sameReference).toBe(true);
    expect(after.state).toBe(before.state);
    expect(after.stored).toBe(before.stored);
    expect(after.recovery.data).toEqual(JSON.parse(before.state));
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  });

  test('restore persistence failure keeps current live data and the recovery copy', async ({ page }) => {
    await setup(page);
    await importAccepted(page);
    const before = await snapshot(page);
    await page.evaluate(() => {
      window.originalLive = S;
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === KEY) throw new Error('Synthetic restore quota failure');
        return window.originalSetItem.call(this, key, value);
      };
    });
    page.once('dialog', dialog => dialog.accept());
    await page.click('#restoreRecovery');
    await expect(page.locator('#status')).toContainText('Wiederherstellen fehlgeschlagen');
    const after = await snapshot(page);
    expect(after).toEqual(before);
    expect(await page.evaluate(() => S === window.originalLive)).toBe(true);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  });

  test('FileReader errors reset the file input and preserve live state', async ({ page }) => {
    const before = await setup(page);
    await page.evaluate(() => {
      window.originalReadAsText = FileReader.prototype.readAsText;
      FileReader.prototype.readAsText = function() { this.onerror(new Event('error')); };
    });
    await importText(page, JSON.stringify(importedState()));
    await expect(page.locator('#status')).toContainText('konnte nicht gelesen werden');
    expect(await snapshot(page)).toEqual(before);
    await page.evaluate(() => { FileReader.prototype.readAsText = window.originalReadAsText; });
  });
});
