const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('Period handling', () => {
  test('quick-extend buttons add 28 / 84 days to settings.days', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="set"]');

    const before = await page.evaluate(() => S.settings.days);
    await page.click('#v-set button[data-extend="28"]');
    const after4w = await page.evaluate(() => S.settings.days);
    await page.click('#v-set button[data-extend="84"]');
    const after12w = await page.evaluate(() => S.settings.days);

    expect(after4w).toBe(before + 28);
    expect(after12w).toBe(before + 28 + 84);
  });

  test('starting a new round archives the old period and resets the live one', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30);
    const state = blankState({
      settings: { name: 'Test Patient', start, days: 90, carbGoal: 45, questions: 'Testfrage?', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
      labs: [{ name: 'Testwert', unit: 'mg/dl', range: '70-99', base: '5.9', end: '5.3' }],
      doseChanges: [{ date: addDays(start, 10), medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }],
    });
    for (let i = 0; i < 20; i++) state.days[addDays(start, i)] = { w: 80 };
    state.weeks[1] = { waist: 90 };
    await seed(page, state);
    await page.click('nav button[data-tab="set"]');

    page.once('dialog', (d) => d.accept());
    await page.click('#v-set button#newRound');
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => ({
      start: S.settings.start,
      today: today(),
      name: S.settings.name,
      carbGoal: S.settings.carbGoal,
      meds: S.settings.meds,
      daysCount: Object.keys(S.days).length,
      weeksCount: Object.keys(S.weeks).length,
      doseChangesCount: S.doseChanges.length,
      labs: S.labs,
      questions: S.settings.questions,
      archiveCount: S.archive.length,
    }));

    expect(after.start).toBe(after.today);
    expect(after.daysCount).toBe(0);
    expect(after.weeksCount).toBe(0);
    expect(after.doseChangesCount).toBe(0);
    expect(after.labs).toEqual([{ name: 'Testwert', unit: 'mg/dl', range: '70-99', base: '', end: '' }]);
    expect(after.questions).toBe('');
    expect(after.meds).toEqual([{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }]);
    expect(after.name).toBe('Test Patient');
    expect(after.carbGoal).toBe(45);
    expect(after.archiveCount).toBe(1);
  });

  test('reprinting an archived report restores the live S object reference', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      archive: [{
        archivedAt: today(),
        label: `${addDays(today(), -90)} – ${addDays(today(), -1)}`,
        data: blankState({ settings: { name: 'Archived Name', start: addDays(today(), -90), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] } }),
      }],
    });
    await seed(page, state);
    await page.evaluate(() => { window.print = () => {}; }); // avoid an actual print dialog

    const result = await page.evaluate(() => {
      const liveRef = S;
      viewArchivedReport(0);
      return {
        restored: S === liveRef,
        printedHasArchivedName: document.getElementById('print').innerHTML.includes('Archived Name'),
      };
    });
    expect(result.restored).toBe(true);
    expect(result.printedHasArchivedName).toBe(true);
  });

  test('deleting an archive entry does not affect the live period', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { name: 'Live Name', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null, meds: [] },
      archive: [{ archivedAt: today(), label: 'old-period', data: blankState() }],
    });
    await seed(page, state);
    await page.click('nav button[data-tab="set"]');

    page.once('dialog', (d) => d.accept());
    await page.click('#v-set button[data-ardel="0"]');
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => ({ archiveCount: S.archive.length, name: S.settings.name }));
    expect(after.archiveCount).toBe(0);
    expect(after.name).toBe('Live Name');
  });
});
