const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('Period handling', () => {
  test('migrates a legacy archived period without changing its history or the live period', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30);
    const liveSettings = blankState().settings;
    const state = blankState({
      settings: { ...liveSettings, name: 'Live Name', alerts: { ...liveSettings.alerts, sysMax: 140 },
        alertHistory: [{ date: null, value: { ...liveSettings.alerts, sysMax: 140 } }] },
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
    expect(result.archived.dataVersion).toBe(5);
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

  test('load migrates v3 medication lifecycle fields inside an archived snapshot', async ({ page }) => {
    await gotoApp(page);
    const legacyMed = { id: 'archivedMed', name: 'Archived testmed', dose: '10 mg', category: 'Medikament' };
    await seed(page, blankState({
      archive: [{
        label: 'Old period', archivedAt: '2026-02-01',
        data: { dataVersion: 3, settings: { ...blankState().settings, meds: [legacyMed] }, days: {} },
      }],
    }));
    const result = await page.evaluate(() => ({ archive: S.archive[0], liveMeds: S.settings.meds }));
    expect(result.archive.label).toBe('Old period');
    expect(result.archive.archivedAt).toBe('2026-02-01');
    expect(result.archive.data.dataVersion).toBe(5);
    expect(result.archive.data.settings.meds).toEqual([{ ...legacyMed, startedAt: null, stoppedAt: null }]);
    expect(result.liveMeds).toEqual([]);
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
      dataVersion: 3,
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
    expect(after.meds).toEqual([{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: null, stoppedAt: null }]);
    expect(after.name).toBe('Test Patient');
    expect(after.carbGoal).toBe(45);
    expect(after.archiveCount).toBe(1);
  });

  test('new round archives all medication episodes and carries only those applicable today', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30);
    const stopped = { id: 'stopped', name: 'Stopped testmed', dose: '5 mg', category: 'Medikament', startedAt: start, stoppedAt: addDays(today(), -1) };
    const ongoing = { id: 'ongoing', name: 'Ongoing testmed', dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: null };
    const stoppingTomorrow = { id: 'tomorrow', name: 'Tomorrow testmed', dose: '2 mg', category: 'Medikament', startedAt: start, stoppedAt: addDays(today(), 1) };
    const future = { id: 'future', name: 'Future testmed', dose: '1 mg', category: 'Medikament', startedAt: addDays(today(), 1), stoppedAt: null };
    const meds = [stopped, ongoing, stoppingTomorrow, future];
    const changes = [{ date: addDays(start, 5), medId: 'stopped', oldDose: '2 mg', newDose: '5 mg' }];
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds },
      days: { [start]: { meds: { stopped: true, ongoing: false } } },
      doseChanges: changes,
    }));
    await page.click('nav button[data-tab="set"]');
    page.once('dialog', (d) => d.accept());
    await page.click('#newRound');

    const result = await page.evaluate(() => ({
      archivedMeds: S.archive[0].data.settings.meds,
      archivedDays: S.archive[0].data.days,
      archivedChanges: S.archive[0].data.doseChanges,
      liveMeds: S.settings.meds,
      liveChanges: S.doseChanges,
      liveStart: S.settings.start,
    }));
    expect(result.archivedMeds).toEqual(meds);
    expect(result.archivedDays[start].meds).toEqual({ stopped: true, ongoing: false });
    expect(result.archivedChanges).toEqual(changes);
    expect(result.liveMeds).toEqual([ongoing, stoppingTomorrow]);
    expect(result.liveChanges).toEqual([]);
    expect(result.liveStart).toBe(today());

    const archivedName = await page.evaluate(() => {
      S.settings.meds[0].name = 'Changed live name';
      return S.archive[0].data.settings.meds[1].name;
    });
    expect(archivedName).toBe('Ongoing testmed');
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

  test('load migrates a v4 archived snapshot to undated goal and alert baselines without copying live settings', async ({ page }) => {
    await gotoApp(page);
    const oldAlerts = { ...blankState().settings.alerts, gMax: 180, action: 'Archived action' };
    const liveAlerts = { ...blankState().settings.alerts, gMax: 140, action: 'Live action' };
    await seed(page, blankState({
      settings: { ...blankState().settings, carbGoal: 20, alerts: liveAlerts,
        carbGoalHistory: [{ date: null, value: 20 }], alertHistory: [{ date: null, value: liveAlerts }] },
      archive: [{ label: 'Old period', archivedAt: '2026-02-01', extra: 'Keep me', data: {
        dataVersion: 4, settings: { name: 'Archived', start: '2026-01-01', days: 7, carbGoal: 45, alerts: oldAlerts }, days: {},
      } }],
    }));
    const result = await page.evaluate(() => ({
      entry: S.archive[0], liveGoal: S.settings.carbGoal, liveAlerts: S.settings.alerts,
      detached: S.archive[0].data.settings.alertHistory[0].value !== S.archive[0].data.settings.alerts,
    }));
    expect(result.entry.label).toBe('Old period');
    expect(result.entry.archivedAt).toBe('2026-02-01');
    expect(result.entry.extra).toBe('Keep me');
    expect(result.entry.data.dataVersion).toBe(5);
    expect(result.entry.data.settings.carbGoalHistory).toEqual([{ date: null, value: 45 }]);
    expect(result.entry.data.settings.alertHistory).toEqual([{ date: null, value: oldAlerts }]);
    expect(result.detached).toBe(true);
    expect(result.liveGoal).toBe(20);
    expect(result.liveAlerts).toEqual(liveAlerts);
  });

  test('new round archives full dated histories and carries only today\'s values into detached fresh histories', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -20), change = addDays(today(), -5);
    const oldAlerts = { ...blankState().settings.alerts, gMax: 180 };
    const currentAlerts = { ...blankState().settings.alerts, gMax: 160 };
    const med = { id: 'medA', name: 'Synthetic med', dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: null };
    const changes = [{ date: addDays(start, 2), medId: med.id, oldDose: '5 mg', newDose: '10 mg' }];
    const goalHistory = [{ date: null, value: 50 }, { date: change, value: 30 }];
    const alertHistory = [{ date: null, value: oldAlerts }, { date: change, value: currentAlerts }];
    await seed(page, blankState({ settings: { ...blankState().settings, start, carbGoal: 30, alerts: currentAlerts,
      carbGoalHistory: goalHistory, alertHistory, meds: [med] }, doseChanges: changes }));
    const result = await page.evaluate(() => {
      startNewRound();
      const archived = S.archive[0].data.settings;
      const before = JSON.stringify([archived.carbGoalHistory, archived.alertHistory]);
      const freshGoals = JSON.parse(JSON.stringify(S.settings.carbGoalHistory));
      const freshAlerts = JSON.parse(JSON.stringify(S.settings.alertHistory));
      S.settings.carbGoalHistory[0].value = 99;
      S.settings.alertHistory[0].value.gMax = 99;
      return {
        archivedGoals: archived.carbGoalHistory, archivedAlerts: archived.alertHistory,
        archivedUnchanged: JSON.stringify([archived.carbGoalHistory, archived.alertHistory]) === before,
        freshGoals, freshAlerts, liveGoals: S.settings.carbGoalHistory, liveAlerts: S.settings.alertHistory,
        scalars: [S.settings.carbGoal, S.settings.alerts.gMax],
        archivedMeds: archived.meds, liveMeds: S.settings.meds,
        archivedChanges: S.archive[0].data.doseChanges, liveChanges: S.doseChanges,
      };
    });
    expect(result.archivedGoals).toEqual(goalHistory);
    expect(result.archivedAlerts).toEqual(alertHistory);
    expect(result.archivedUnchanged).toBe(true);
    expect(result.freshGoals).toEqual([{ date: today(), value: 30 }]);
    expect(result.freshAlerts).toEqual([{ date: today(), value: currentAlerts }]);
    expect(result.liveGoals).toEqual([{ date: today(), value: 99 }]);
    expect(result.liveAlerts[0]).toEqual({ date: today(), value: { ...currentAlerts, gMax: 99 } });
    expect(result.scalars).toEqual([30, 160]);
    expect(result.archivedMeds).toEqual([med]);
    expect(result.liveMeds).toEqual([med]);
    expect(result.archivedChanges).toEqual(changes);
    expect(result.liveChanges).toEqual([]);
  });

  test('archived report uses archived dated settings and restores the exact live object', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -14), change = addDays(start, 7);
    const old = { ...blankState().settings.alerts, gMax: 180 };
    const next = { ...blankState().settings.alerts, gMax: 160 };
    const archived = blankState({ settings: { ...blankState().settings, name: 'Archived', start, days: 14,
      carbGoal: 30, alerts: next, carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }],
      alertHistory: [{ date: null, value: old }, { date: change, value: next }] },
      days: { [addDays(start, 1)]: { c: 40, g: 170 }, [addDays(start, 8)]: { c: 40, g: 170 } } });
    await seed(page, blankState({ settings: { ...blankState().settings, name: 'Live', carbGoal: 10,
      carbGoalHistory: [{ date: null, value: 10 }] },
      archive: [{ label: 'Archived', archivedAt: today(), data: archived }] }));
    const result = await page.evaluate(() => {
      window.print = () => {};
      const live = S, before = JSON.stringify(S);
      viewArchivedReport(0);
      return { restored: S === live, unchanged: JSON.stringify(S) === before,
        html: document.getElementById('print').innerHTML };
    });
    expect(result.restored).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.html).toContain('Archived');
    expect(result.html).toContain('an 1 von 2 Tagen über dem jeweils gültigen Limit');
    expect(result.html).toContain('max 160 mg/dl');
    expect(result.html).not.toContain('max 180 mg/dl');
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
