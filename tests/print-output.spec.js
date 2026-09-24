const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, addDays, today } = require('./helpers');

const mmToPx = (mm) => (mm * 96) / 25.4;

test.describe('Print output', () => {
  test('fridge sheet fits on one A4 landscape page with 6 medications', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-01-05'; // a Monday
    const meds = Array.from({ length: 6 }, (_, i) => ({ id: `med${i}`, name: `Testmed ${String.fromCharCode(65 + i)}`, dose: '10 mg', category: 'Medikament' }));
    const state = blankState({ settings: { name: 'Test Patient', start, days: 90, carbGoal: 50, questions: '', lastBackup: null, meds } });
    for (let d = 0; d < 7; d++) {
      const ds = addDays(start, d);
      const medState = {};
      meds.forEach((m) => { medState[m.id] = d % 2 === 0; });
      // Two full BP readings per day (the taller, realistic case) so the one-page fit is checked against the worst case.
      state.days[ds] = { w: 82, g: 95, k: 0.8, sys1: 120, dia1: 80, sys2: 118, dia2: 78, c: 40, en: 3, hu: 3, plan: 'y', meds: medState, sym: d === 1 ? ['Kopfschmerz'] : undefined, note: d === 1 ? 'Testnotiz' : undefined };
    }
    state.weeks[1] = { waist: 90, rhr: 64, sleep: 7.2, stress: 27, steps: 8300, note: 'Testnotiz Woche' };
    await seed(page, state);

    // A4 landscape content area at the app's 10mm @page margins: 277 x 190mm.
    const contentW = mmToPx(277), contentH = mmToPx(190);
    await page.setViewportSize({ width: Math.round(contentW), height: Math.round(contentH) + 400 });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate((w) => {
      document.getElementById('print').innerHTML = sheetHTML(1, true);
      document.querySelector('.sheet').style.width = w + 'px';
    }, contentW);
    await page.waitForTimeout(100);

    const sheetHeightPx = await page.locator('.sheet').evaluate((el) => el.getBoundingClientRect().height);
    expect(sheetHeightPx).toBeLessThanOrEqual(contentH);
  });

  test('report renders every section including Quellen', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -60);
    const state = blankState({
      settings: { name: 'Test Patient', start, days: 90, carbGoal: 50, questions: 'Testfrage?', lastBackup: null,
        meds: [{ id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament' }] },
      labs: [{ name: 'Testwert', unit: 'mg/dl', range: '70-99', base: '104', end: '88' }],
      labDates: { base: addDays(start, -3), end: addDays(start, 60) },
      doseChanges: [{ date: addDays(start, 10), medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }],
    });
    for (let i = 0; i < 42; i++) {
      const ds = addDays(start, i);
      state.days[ds] = { w: 80, g: 95, k: 0.8, sys: 120, dia: 80, c: 40, en: 3, hu: 3, plan: 'y', meds: { medA: true } };
    }
    state.weeks[1] = { waist: 90, rhr: 64, sleep: 7.2, stress: 27, steps: 8300, note: 'Testnotiz' };
    await seed(page, state);

    const html = await page.evaluate(() => reportHTML());
    for (const heading of ['Verlauf im Überblick', 'Umsetzung', 'Kurven', 'Laborwerte', 'Medikation', 'Beschwerden', 'Notizen', 'Beobachtungen für das Gespräch', 'Fragen für die Besprechung', 'Quellen']) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
    expect((html.match(/<ul class="refs">(.*?)<\/ul>/s)[1].match(/<li>/g) || []).length).toBe(13);
  });
});
