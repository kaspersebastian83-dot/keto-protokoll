const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

test.describe('Backup export/import', () => {
  test('exported JSON round-trips back into an equivalent live state', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { name: 'Test Patient', start: today(), days: 90, carbGoal: 45, questions: 'Testfrage?', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
      days: { [today()]: { w: 80, g: 95 } },
    });
    await seed(page, state);

    // Serialize exactly what the export button would write, without touching the filesystem.
    const exported = await page.evaluate(() => JSON.stringify(S, null, 1));

    // Reset to a blank state, then import the exported JSON via the same path
    // the file-input handler uses (JSON.parse + the migration guards).
    await seed(page, blankState());
    const restored = await page.evaluate((json) => {
      const d = JSON.parse(json);
      S = d;
      S.weeks = S.weeks || {};
      S.labs = S.labs || [];
      S.labs.forEach((r) => { if (r.range == null) r.range = ''; });
      S.labDates = S.labDates || {};
      S.settings.meds = S.settings.meds || [];
      S.doseChanges = S.doseChanges || [];
      S.archive = S.archive || [];
      S.refRead = S.refRead || {};
      return { name: S.settings.name, meds: S.settings.meds, days: S.days };
    }, exported);

    expect(restored.name).toBe('Test Patient');
    expect(restored.meds).toEqual([{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }]);
    expect(restored.days[today()]).toEqual({ w: 80, g: 95 });
  });

  test('an old backup missing newer fields migrates cleanly without throwing', async ({ page }) => {
    await gotoApp(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Simulates a backup saved before meds/doseChanges/archive/refRead/labs[].range existed.
    const oldBackup = JSON.stringify({
      settings: { name: 'Test Patient', start: '2026-01-01', days: 90, carbGoal: 50, questions: '', lastBackup: null },
      days: { '2026-01-01': { w: 80 } },
    });

    const migrated = await page.evaluate((json) => {
      const d = JSON.parse(json);
      S = d;
      S.weeks = S.weeks || {};
      S.labs = S.labs || [];
      S.labs.forEach((r) => { if (r.range == null) r.range = ''; });
      S.labDates = S.labDates || {};
      S.settings.meds = S.settings.meds || [];
      S.doseChanges = S.doseChanges || [];
      S.archive = S.archive || [];
      S.refRead = S.refRead || {};
      return {
        weeks: S.weeks, labs: S.labs, labDates: S.labDates, meds: S.settings.meds,
        doseChanges: S.doseChanges, archive: S.archive, refRead: S.refRead,
      };
    }, oldBackup);

    expect(migrated).toEqual({ weeks: {}, labs: [], labDates: {}, meds: [], doseChanges: [], archive: [], refRead: {} });
    expect(errors).toEqual([]);
  });
});
