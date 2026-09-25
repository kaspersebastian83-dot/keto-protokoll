const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('Medication log', () => {
  test('add and delete a medication in Einstellungen', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="set"]');

    await page.click('#medAdd');
    await page.fill('#v-set input[data-mk="name"] >> nth=0', 'Testmed A');
    await page.fill('#v-set input[data-mk="dose"] >> nth=0', '10 mg');
    await page.locator('#v-set input[data-mk="dose"] >> nth=0').blur();

    let meds = await page.evaluate(() => S.settings.meds);
    expect(meds).toHaveLength(1);
    expect(meds[0].name).toBe('Testmed A');
    expect(meds[0].dose).toBe('10 mg');
    expect(meds[0].startedAt).toBe(today());
    expect(meds[0].stoppedAt).toBeNull();

    await page.click('nav button[data-tab="day"]');
    await page.fill('#dpick', addDays(today(), -1));
    expect(await page.locator('#v-day button[data-med]').count()).toBe(0);
    await page.click('nav button[data-tab="set"]');

    page.once('dialog', (d) => d.accept());
    await page.click('#v-set button[data-mdel="0"]');
    meds = await page.evaluate(() => S.settings.meds);
    expect(meds).toHaveLength(0);
  });

  test('v3 medications gain unknown lifecycle dates without losing identity, and migration is idempotent', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      dataVersion: 3,
      settings: { ...blankState().settings, meds: [
        { id: 'legacyA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' },
        { id: 'legacyB', name: 'Test supplement', dose: '2 units', category: 'Nahrungsergänzung', startedAt: '2026-01-05' },
      ] },
    }));

    const result = await page.evaluate(() => {
      const first = JSON.stringify(S);
      migrate(S);
      return { version: S.dataVersion, meds: S.settings.meds, unchangedOnSecondMigration: JSON.stringify(S) === first };
    });
    expect(result.version).toBe(6);
    expect(result.meds).toEqual([
      { id: 'legacyA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: null, stoppedAt: null },
      { id: 'legacyB', name: 'Test supplement', dose: '2 units', category: 'Nahrungsergänzung', startedAt: '2026-01-05', stoppedAt: null },
    ]);
    expect(result.unchangedOnSecondMigration).toBe(true);
  });

  test('stopping a logged medication preserves its history and limits daily and weekly views', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -14), stopAt = addDays(start, 3);
    const med = { id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: null };
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [med] },
      days: {
        [start]: { meds: { medA: true } },
        [addDays(start, 1)]: { meds: { medA: false } },
        [addDays(start, 4)]: { meds: { medA: true } },
      },
      doseChanges: [{ date: addDays(start, 1), medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }],
    }));
    await page.click('nav button[data-tab="set"]');

    page.once('dialog', (d) => d.accept('2026-02-30'));
    await page.click('#v-set button[data-mdel="0"]');
    expect(await page.evaluate(() => S.settings.meds[0].stoppedAt)).toBeNull();

    const stopDialogs = [];
    page.on('dialog', async (d) => { stopDialogs.push(d.type()); await d.accept(d.type() === 'prompt' ? stopAt : undefined); });
    await page.click('#v-set button[data-mdel="0"]');
    expect(stopDialogs).toEqual(['prompt', 'confirm']);
    const state = await page.evaluate(() => ({ meds: S.settings.meds, days: S.days, doseChanges: S.doseChanges, markers: doseMarkers() }));
    expect(state.meds).toEqual([{ ...med, stoppedAt: stopAt }]);
    expect(state.days[start].meds.medA).toBe(true);
    expect(state.days[addDays(start, 1)].meds.medA).toBe(false);
    expect(state.days[addDays(start, 4)].meds.medA).toBe(true);
    expect(state.doseChanges).toHaveLength(1);
    expect(state.markers[0].label).toContain('Testmed A');
    await expect(page.locator('#v-set')).toContainText('Beendet ab');
    expect(await page.locator('#v-set button[data-mdel]').count()).toBe(0);

    await page.click('nav button[data-tab="day"]');
    await page.fill('#dpick', addDays(start, 1));
    expect(await page.locator('#v-day button[data-med="medA"]').count()).toBe(2);
    await page.fill('#dpick', stopAt);
    expect(await page.locator('#v-day button[data-med="medA"]').count()).toBe(0);

    await page.click('nav button[data-tab="week"]');
    await page.selectOption('#wsel', '1');
    await expect(page.locator('#v-week')).toContainText('Testmed A');
    await expect(page.locator('#v-week')).toContainText('50 %');
    await expect(page.locator('#v-week')).toContainText('1/2 Tage');
    await page.selectOption('#wsel', '2');
    expect(await page.locator('#v-week').textContent()).not.toContain('Testmed A');

    await page.click('nav button[data-tab="set"]');
    await page.click('#medAdd');
    const episodes = await page.evaluate(() => S.settings.meds);
    expect(episodes).toHaveLength(2);
    expect(episodes[0].stoppedAt).toBe(stopAt);
    expect(episodes[1].id).not.toBe('medA');
    expect(episodes[1]).toMatchObject({ startedAt: today(), stoppedAt: null });
  });

  test('a dose change alone counts as history when stopping a medication', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { ...blankState().settings, meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: null, stoppedAt: null }] },
      doseChanges: [{ date: today(), medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }],
    }));
    await page.click('nav button[data-tab="set"]');
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? today() : undefined));
    await page.click('#v-set button[data-mdel="0"]');
    const state = await page.evaluate(() => ({ meds: S.settings.meds, changes: S.doseChanges }));
    expect(state.meds).toHaveLength(1);
    expect(state.meds[0].stoppedAt).toBe(today());
    expect(state.changes).toHaveLength(1);
  });

  test('untouched vs. taken vs. not taken are distinguishable', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
    }));
    await page.click('nav button[data-tab="day"]');

    // untouched: no key at all in S.days[today].meds
    let d = await page.evaluate(() => S.days[today()]);
    expect(d).toBeUndefined();

    await page.click('#v-day button[data-med="medA"][data-mv="1"]');
    d = await page.evaluate(() => S.days[today()].meds.medA);
    expect(d).toBe(true);

    // click "Nicht genommen" -> becomes explicitly false, not just cleared
    await page.click('#v-day button[data-med="medA"][data-mv="0"]');
    d = await page.evaluate(() => S.days[today()].meds.medA);
    expect(d).toBe(false);

    // clicking the same (already active) state again clears it back to untouched
    await page.click('#v-day button[data-med="medA"][data-mv="0"]');
    const cleared = await page.evaluate(() => S.days[today()].meds);
    expect(cleared).toBeUndefined();
  });

  test('dose change is logged to doseChanges and updates the current dose', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({
      settings: { name: '', start: today(), days: 90, carbGoal: 50, questions: '', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
    }));
    await page.click('nav button[data-tab="set"]');

    const dialogs = ['20 mg', today()];
    page.on('dialog', async (d) => { await d.accept(dialogs.shift()); });
    await page.click('#v-set button[data-mdose="0"]');
    await page.waitForTimeout(100);

    const state = await page.evaluate(() => ({ meds: S.settings.meds, doseChanges: S.doseChanges }));
    expect(state.meds[0].dose).toBe('20 mg');
    expect(state.doseChanges).toHaveLength(1);
    expect(state.doseChanges[0]).toMatchObject({ medId: 'medA', oldDose: '10 mg', newDose: '20 mg' });
  });

  test('weekly adherence percentage reflects taken vs. logged days', async ({ page }) => {
    await gotoApp(page);
    const start = today();
    await seed(page, blankState({
      settings: { name: '', start, days: 90, carbGoal: 50, questions: '', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
      days: {
        [start]: { meds: { medA: true } },
      },
    }));
    // Add a second day within the first week: taken=false
    await page.evaluate((start) => {
      const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      const [y,m,dd] = start.split('-').map(Number);
      const dt = new Date(y, m-1, dd); dt.setDate(dt.getDate()+1);
      S.days[iso(dt)] = { meds: { medA: false } };
      save();
    }, start);

    await page.click('nav button[data-tab="week"]');
    const text = await page.locator('#v-week').textContent();
    expect(text).toContain('Einnahme diese Woche');
    expect(text).toContain('50 %'); // 1 of 2 logged days taken
  });

  test('adherence counts only boolean medication logs and leaves malformed raw values unchanged', async ({ page }) => {
    await gotoApp(page);
    const start = today();
    const days = {
      [start]: { meds: { medA: true } },
      [addDays(start, 1)]: { meds: { medA: false } },
      [addDays(start, 2)]: { meds: { medA: null } },
      [addDays(start, 3)]: { meds: { medA: 'yes' } },
      [addDays(start, 4)]: { meds: { medA: 1 } },
      [addDays(start, 5)]: { note: 'Synthetic day without medication key' },
    };
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] },
      days,
    }));

    const result = await page.evaluate((to) => ({
      adherence: medAdherence(S.settings.start, to, S.settings.meds[0]),
      raw: [S.days[addDays(S.settings.start, 2)].meds.medA, S.days[addDays(S.settings.start, 3)].meds.medA, S.days[addDays(S.settings.start, 4)].meds.medA],
    }), addDays(start, 5));
    expect(result.adherence).toEqual({ taken: 1, logged: 2 });
    expect(result.raw).toEqual([null, 'yes', 1]);

    await page.click('nav button[data-tab="week"]');
    await page.selectOption('#wsel', '1');
    await expect(page.locator('#v-week')).toContainText('50 %');
    await expect(page.locator('#v-week')).toContainText('1/2 Tage');
  });

  test('historical identity is locked in the UI and handler while an active dose change remains available', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-01';
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '5 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] },
      days: { [start]: { meds: { medA: true } } },
    }));
    await page.click('nav button[data-tab="set"]');
    await expect(page.locator('[data-mi="0"][data-mk="name"]')).toHaveAttribute('readonly', '');
    await expect(page.locator('[data-mi="0"][data-mk="dose"]')).toHaveAttribute('readonly', '');
    await expect(page.locator('[data-mi="0"][data-mk="category"]')).toBeDisabled();
    await expect(page.locator('#v-set')).toContainText('Historischer Eintrag');
    expect(await page.locator('[data-mdose="0"]').count()).toBe(1);

    const unchanged = await page.evaluate(() => {
      const before = JSON.stringify(S.settings.meds[0]);
      for (const [field, value] of [['name', 'Rewritten'], ['dose', '99 mg'], ['category', 'Nahrungsergänzung']]) {
        const control = document.querySelector(`[data-mi="0"][data-mk="${field}"]`);
        control.value = value;
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return JSON.stringify(S.settings.meds[0]) === before;
    });
    expect(unchanged).toBe(true);

    const answers = ['10 mg', '2026-09-02'];
    page.on('dialog', (d) => d.accept(answers.shift()));
    await page.click('[data-mdose="0"]');
    expect(await page.evaluate(() => S.doseChanges)).toEqual([{ date: '2026-09-02', medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }]);

    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '2026-09-03' : undefined));
    await page.click('[data-mdel="0"]');
    expect(await page.locator('[data-mdose="0"]').count()).toBe(0);
    expect(await page.locator('[data-mdel="0"]').count()).toBe(0);
    const stoppedUnchanged = await page.evaluate(() => {
      const before = JSON.stringify(S.settings.meds[0]);
      const beforeChanges = JSON.stringify(S.doseChanges);
      for (const [field, value] of [['name', 'Rewritten'], ['dose', '99 mg'], ['category', 'Nahrungsergänzung']]) {
        const control = document.querySelector(`[data-mi="0"][data-mk="${field}"]`);
        control.value = value;
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const button = document.createElement('button');
      button.dataset.mdose = '0';
      document.querySelector('#v-set').append(button);
      button.click();
      button.remove();
      return JSON.stringify(S.settings.meds[0]) === before && JSON.stringify(S.doseChanges) === beforeChanges;
    });
    expect(stoppedUnchanged).toBe(true);
  });

  test('dated doses use the first old dose and the latest effective change without mutating history', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-01';
    const changes = [
      { date: '2026-09-20', medId: 'medA', oldDose: '10 mg', newDose: '20 mg' },
      { date: '2026-09-10', medId: 'medA', oldDose: '5 mg', newDose: '10 mg' },
    ];
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '20 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] },
      doseChanges: changes,
    }));
    const result = await page.evaluate(() => {
      const before = JSON.stringify(S.doseChanges);
      const doses = ['2026-09-05', '2026-09-10', '2026-09-15', '2026-09-20', '2026-09-25'].map(date => medDoseOnDate(S.settings.meds[0], date));
      return { doses, unchanged: JSON.stringify(S.doseChanges) === before };
    });
    expect(result).toEqual({ doses: ['5 mg', '10 mg', '10 mg', '20 mg', '20 mg'], unchanged: true });
    await page.click('nav button[data-tab="day"]');
    await page.fill('#dpick', '2026-09-05');
    await expect(page.locator('#v-day .panel:has(h2:text-is("Medikamente"))')).toContainText('5 mg');
    await page.fill('#dpick', '2026-09-25');
    await expect(page.locator('#v-day .panel:has(h2:text-is("Medikamente"))')).toContainText('20 mg');
  });

  test('stop dates reject invalid and non-later dates without an extra confirmation for clean stops', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-01';
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '5 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] },
      days: { [start]: { meds: { medA: true } } },
    }));
    await page.click('nav button[data-tab="set"]');
    const answers = ['2026-02-31', '2026-08-31', start, '2026-09-03'];
    const types = [];
    page.on('dialog', async (d) => { types.push(d.type()); await d.accept(answers.shift()); });
    for (const date of ['invalid', 'before', 'equal']) {
      await page.click('[data-mdel="0"]');
      expect(await page.evaluate(() => S.settings.meds[0].stoppedAt), date).toBeNull();
    }
    await page.click('[data-mdel="0"]');
    expect(await page.evaluate(() => S.settings.meds[0].stoppedAt)).toBe('2026-09-03');
    expect(types).toEqual(['prompt', 'prompt', 'prompt', 'prompt']);
  });

  test('backdated stop requires confirmation and retains excluded logs and dose changes in backup', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-01', stopAt = '2026-09-02';
    const laterLog = '2026-09-03';
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] },
      days: { [start]: { meds: { medA: true } }, [stopAt]: { meds: { medA: false } }, [laterLog]: { meds: { medA: true } } },
      doseChanges: [{ date: laterLog, medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }],
    }));
    await page.click('nav button[data-tab="set"]');
    const seen = [];
    let acceptStop = false;
    page.on('dialog', async (d) => {
      seen.push({ type: d.type(), message: d.message() });
      if (d.type() === 'prompt') await d.accept(stopAt);
      else if (acceptStop) await d.accept();
      else await d.dismiss();
    });
    await page.click('[data-mdel="0"]');
    expect(await page.evaluate(() => S.settings.meds[0].stoppedAt)).toBeNull();
    acceptStop = true;
    await page.click('[data-mdel="0"]');
    expect(await page.evaluate(() => S.settings.meds[0].stoppedAt)).toBe(stopAt);
    expect(seen.map(d => d.type)).toEqual(['prompt', 'confirm', 'prompt', 'confirm']);
    expect(seen[1].message).toContain('bleiben gespeichert');
    expect(seen[1].message).toContain('nicht mehr berücksichtigt');

    const raw = await page.evaluate(() => ({ state: S, saved: JSON.parse(localStorage.getItem('ketoProtokoll_v1')), adherence: medAdherence('2026-09-01', '2026-09-07', S.settings.meds[0]) }));
    expect(raw.state.days[stopAt].meds.medA).toBe(false);
    expect(raw.state.days[laterLog].meds.medA).toBe(true);
    expect(raw.state.doseChanges).toHaveLength(1);
    expect(raw.saved.days[laterLog].meds.medA).toBe(true);
    expect(raw.saved.doseChanges).toHaveLength(1);
    expect(raw.adherence).toEqual({ taken: 1, logged: 1 });
    await page.click('nav button[data-tab="day"]');
    await page.fill('#dpick', laterLog);
    expect(await page.locator('#v-day button[data-med="medA"]').count()).toBe(0);
    await page.click('nav button[data-tab="week"]');
    await page.selectOption('#wsel', '1');
    await expect(page.locator('#v-week')).toContainText('1/1 Tage');

    await page.click('nav button[data-tab="set"]');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#exp');
    const backup = JSON.parse(await fs.readFile(await (await downloadPromise).path(), 'utf8'));
    expect(backup.days[laterLog].meds.medA).toBe(true);
    expect(backup.doseChanges).toHaveLength(1);
  });

  test('dose-change dates reject impossible and out-of-episode dates, including synthetic stopped clicks', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-01';
    await seed(page, blankState({ settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '5 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] } }));
    await page.click('nav button[data-tab="set"]');
    const dates = ['2026-02-31', '2026-08-31', start];
    const types = [];
    page.on('dialog', async (d) => { types.push(d.type()); await d.accept(d.message().startsWith('Neue Dosis') ? '10 mg' : dates.shift()); });
    for (let i = 0; i < 2; i++) {
      await page.click('[data-mdose="0"]');
      expect(await page.evaluate(() => S.doseChanges)).toEqual([]);
      expect(await page.evaluate(() => S.settings.meds[0].dose)).toBe('5 mg');
    }
    await page.click('[data-mdose="0"]');
    expect(await page.evaluate(() => S.doseChanges)).toHaveLength(1);
    expect(types).toEqual(['prompt', 'prompt', 'prompt', 'prompt', 'prompt', 'prompt']);
    await page.evaluate(() => { S.settings.meds[0].stoppedAt = '2026-09-20'; save(); renderSet(); });
    expect(await page.locator('[data-mdose="0"]').count()).toBe(0);
    const blocked = await page.evaluate(() => {
      const before = JSON.stringify(S.doseChanges);
      const button = document.createElement('button');
      button.dataset.mdose = '0';
      document.querySelector('#v-set').append(button);
      button.click();
      button.remove();
      return JSON.stringify(S.doseChanges) === before;
    });
    expect(blocked).toBe(true);
  });
});
