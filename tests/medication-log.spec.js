const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

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

    page.once('dialog', (d) => d.accept());
    await page.click('#v-set button[data-mdel="0"]');
    meds = await page.evaluate(() => S.settings.meds);
    expect(meds).toHaveLength(0);
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
});
