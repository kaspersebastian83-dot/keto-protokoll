const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('Period handling', () => {
  test('migrates a legacy archived period without changing its history or the live period', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30);
    const liveSettings = blankState().settings;
    const state = blankState({
      settings: { ...liveSettings, name: 'Live Name', alerts: { ...liveSettings.alerts, sysMax: 140 } },
      days: { [today()]: { sys1: 119, dia1: 76, sys: 119, dia: 76 } },
      archive: [{
        label: 'Legacy period', archivedAt: '2026-02-01',
        data: {
          settings: { name: 'Archived Name', start, days: 30, carbGoal: 42, questions: 'Historical note' },
          days: { [start]: { sys: 128, dia: 82, w: 78 } },
          weeks: { 1: { waist: 88 } },
        },
      }],
    });
    await seed(page, state);

    const result = await page.evaluate(() => ({
      metadata: { label: S.archive[0].label, archivedAt: S.archive[0].archivedAt },
      archived: S.archive[0].data,
      live: { name: S.settings.name, alerts: S.settings.alerts, day: S.days[today()] },
    }));
    expect(result.metadata).toEqual({ label: 'Legacy period', archivedAt: '2026-02-01' });
    expect(result.archived.dataVersion).toBe(3);
    expect(result.archived.settings.name).toBe('Archived Name');
    expect(result.archived.settings.start).toBe(start);
    expect(result.archived.settings.carbGoal).toBe(42);
    expect(result.archived.settings.questions).toBe('Historical note');
    expect(result.archived.settings.alerts).toEqual(blankState().settings.alerts);
    expect(result.archived.days[start]).toEqual({ sys: 128, dia: 82, sys1: 128, dia1: 82, w: 78 });
    expect(result.archived.weeks[1]).toEqual({ waist: 88 });
    expect(result.live).toEqual({
      name: 'Live Name', alerts: { ...liveSettings.alerts, sysMax: 140 },
      day: { sys1: 119, dia1: 76, sys: 119, dia: 76 },
    });
  });

  test('a malformed archived snapshot stays unchanged while later archives migrate', async ({ page }) => {
    await gotoApp(page);
    const date = '2026-01-01';
    const malformedSnapshot = {
      settings: { name: 'Malformed', start: date },
      days: { [date]: { sys: 127, dia: 81 } },
      labs: { invalid: 'shape' }, // migrateState() would add defaults before labs.forEach throws
    };
    const state = blankState({
      settings: { ...blankState().settings, name: 'Live Name' },
      days: { [today()]: { w: 75 } },
      archive: [
        { label: 'Malformed', archivedAt: '2026-02-01', data: malformedSnapshot },
        {
          label: 'Valid', archivedAt: '2026-02-02',
          data: { settings: { name: 'Valid', start: date, days: 7 }, days: { [date]: { sys: 128, dia: 82 } } },
        },
      ],
    });
    await seed(page, state);

    const result = await page.evaluate(() => ({
      liveName: S.settings.name,
      liveDay: S.days[today()],
      malformed: S.archive[0].data,
      malformedJSON: JSON.stringify(S.archive[0].data),
      valid: S.archive[1].data,
      metadata: S.archive.map(({ label, archivedAt }) => ({ label, archivedAt })),
    }));
    expect(result.liveName).toBe('Live Name');
    expect(result.liveDay).toEqual({ w: 75 });
    expect(result.malformedJSON).toBe(JSON.stringify(malformedSnapshot));
    expect(result.malformed).toEqual(malformedSnapshot);
    expect(result.valid.days[date]).toEqual({ sys: 128, dia: 82, sys1: 128, dia1: 82 });
    expect(result.valid.settings.alerts).toEqual(blankState().settings.alerts);
    expect(result.metadata).toEqual([
      { label: 'Malformed', archivedAt: '2026-02-01' },
      { label: 'Valid', archivedAt: '2026-02-02' },
    ]);
  });

  test('preserves both archived BP readings and recomputes their daily average', async ({ page }) => {
    await gotoApp(page);
    const date = '2026-01-01';
    const state = blankState({
      archive: [{
        label: 'Two readings', archivedAt: '2026-02-01',
        data: {
          dataVersion: 3,
          settings: { name: 'Archived Name', start: date, days: 7, alerts: {} },
          days: { [date]: { sys1: 121, dia1: 79, sys2: 131, dia2: 83, sys: 120, dia: 80 } },
        },
      }],
    });
    const day = await page.evaluate((saved) => {
      const migrated = migrate(saved);
      return migrated.archive[0].data.days['2026-01-01'];
    }, state);

    expect(day).toEqual({ sys1: 121, dia1: 79, sys2: 131, dia2: 83, sys: 126, dia: 81 });
  });

  test('archive migration is idempotent and does not traverse nested archives', async ({ page }) => {
    await gotoApp(page);
    const date = '2026-01-01';
    const state = blankState({
      archive: [{
        label: 'Outer', archivedAt: '2026-02-01',
        data: {
          settings: { name: 'Outer', start: date, days: 7 },
          days: { [date]: { sys: 128, dia: 82 } },
          archive: [{ label: 'Nested', data: { settings: { start: date }, days: { [date]: { sys: 111, dia: 71 } } } }],
        },
      }, {
        label: 'Future', archivedAt: '2026-03-01',
        data: {
          dataVersion: 999,
          settings: { name: 'Future', start: date },
          days: { [date]: { sys: 130, dia: 80 } },
          archive: [{ data: { days: { [date]: { sys: 120, dia: 70 } } } }],
        },
      }, { label: 'Malformed', data: [] }],
    });
    const result = await page.evaluate((saved) => {
      const once = migrate(saved);
      const first = JSON.stringify(once);
      const twice = migrate(once);
      return {
        first, second: JSON.stringify(twice),
        nestedDay: twice.archive[0].data.archive[0].data.days['2026-01-01'],
        future: twice.archive[1].data,
        malformed: twice.archive[2].data,
      };
    }, state);

    expect(result.second).toBe(result.first);
    expect(result.nestedDay).toEqual({ sys: 111, dia: 71 });
    expect(result.future).toEqual(state.archive[1].data);
    expect(result.malformed).toEqual([]);
  });

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

  test('a migrated legacy BP report restores the exact live S reference and state', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30);
    const state = blankState({
      settings: { ...blankState().settings, name: 'Live Name' },
      days: { [today()]: { w: 75 } },
      archive: [{
        archivedAt: today(),
        label: 'Legacy period',
        data: {
          settings: { name: 'Archived Name', start, days: 30, carbGoal: 50 },
          days: { [start]: { sys: 128, dia: 82 } },
        },
      }],
    });
    await seed(page, state);
    await page.evaluate(() => { window.print = () => {}; }); // avoid an actual print dialog

    const result = await page.evaluate(() => {
      const liveRef = S;
      const before = JSON.stringify(S);
      viewArchivedReport(0);
      return {
        restored: S === liveRef,
        unchanged: JSON.stringify(S) === before,
        printedHasArchivedName: document.getElementById('print').innerHTML.includes('Archived Name'),
        printedHasLegacyBP: document.getElementById('print').innerHTML.includes('Blutdruck an 0 Tagen mit zwei Messungen erfasst, an 1 Tagen mit einer.'),
      };
    });
    expect(result.restored).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.printedHasArchivedName).toBe(true);
    expect(result.printedHasLegacyBP).toBe(true);
  });

  test('a report error restores the live S reference and leaves live data unchanged', async ({ page }) => {
    await gotoApp(page);
    const state = blankState({
      settings: { ...blankState().settings, name: 'Live Name' },
      days: { [today()]: { w: 75 } },
      archive: [{ label: 'Archived', archivedAt: today(), data: blankState() }],
    });
    await seed(page, state);

    const result = await page.evaluate(() => {
      const liveRef = S;
      const before = JSON.stringify(S);
      const originalReportHTML = reportHTML;
      let errorMessage;
      try{
        reportHTML = () => { throw new Error('Synthetic report failure'); };
        try{viewArchivedReport(0)}catch(e){errorMessage=e.message}
      }finally{reportHTML=originalReportHTML}
      return {
        errorMessage,
        restored: S === liveRef,
        unchanged: JSON.stringify(S) === before,
        reportFunctionRestored: reportHTML === originalReportHTML,
      };
    });
    expect(result.errorMessage).toBe('Synthetic report failure');
    expect(result.restored).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.reportFunctionRestored).toBe(true);
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
