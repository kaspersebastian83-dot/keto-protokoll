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

  test('fridge sheet marks dates outside a medication episode as not applicable', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-01-05';
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [
        { id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: addDays(start, 1), stoppedAt: addDays(start, 4) },
        { id: 'medB', name: 'Later testmed', dose: '5 mg', category: 'Medikament', startedAt: addDays(start, 7), stoppedAt: null },
      ] },
      days: {
        [addDays(start, 1)]: { meds: { medA: true } },
        [addDays(start, 2)]: { meds: { medA: false } },
      },
    }));

    const rows = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(sheetHTML(1, true), 'text/html');
      return [...doc.querySelectorAll('.zone-vitals tr')].map(row => ({
        label: row.querySelector('th').textContent,
        cells: [...row.querySelectorAll('td')].map(cell => cell.textContent.trim()),
      }));
    });
    expect(rows.find(row => row.label.includes('Testmed A')).cells).toEqual(['–', '✓', '✗', '□', '–', '–', '–']);
    expect(rows.some(row => row.label.includes('Later testmed'))).toBe(false);
  });

  test('fridge sheet uses the historical dose for a week before a change', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-07';
    await seed(page, blankState({
      settings: { ...blankState().settings, start, meds: [{ id: 'medA', name: 'Testmed A', dose: '20 mg', category: 'Medikament', startedAt: start, stoppedAt: null }] },
      doseChanges: [{ date: '2026-09-20', medId: 'medA', oldDose: '5 mg', newDose: '20 mg' }],
    }));
    const labels = await page.evaluate(() => [1, 3].map(week => {
      const doc = new DOMParser().parseFromString(sheetHTML(week, false), 'text/html');
      return [...doc.querySelectorAll('.zone-vitals tr')].find(row => row.querySelector('th').textContent.includes('Testmed A')).querySelector('th').textContent;
    }));
    expect(labels[0]).toContain('5 mg');
    expect(labels[0]).not.toContain('20 mg');
    expect(labels[1]).toContain('20 mg');
  });

  test('fridge sheet shows within-week goal and threshold changes and still fits A4 landscape', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-07', change = '2026-09-10';
    const old = { ...blankState().settings.alerts, gMax: 180, action: 'Old action' };
    const next = { ...blankState().settings.alerts, gMax: 160, action: 'New action' };
    const meds = Array.from({ length: 6 }, (_, i) => ({ id: `med${i}`, name: `Synthetic med ${i}`, dose: '10 mg', category: 'Medikament' }));
    const state = blankState({ settings: { ...blankState().settings, start, days: 14, carbGoal: 30, alerts: next, meds,
      carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }],
      alertHistory: [{ date: null, value: old }, { date: change, value: next }] } });
    for (let i = 0; i < 7; i++) state.days[addDays(start, i)] = {
      w: 80, g: 95, k: 0.8, sys1: 120, dia1: 80, sys2: 118, dia2: 78,
      c: 40, en: 3, hu: 3, plan: 'y', meds: Object.fromEntries(meds.map(m => [m.id, true])),
    };
    await seed(page, state);
    const html = await page.evaluate(() => sheetHTML(1, true));
    expect(html).toContain('g, Limit 50 → 30 g');
    expect(html).toContain('07.09.');
    expect(html).toContain('ab 10.09.');
    expect(html).toContain('BZ ––180');
    expect(html).toContain('BZ ––160');
    expect(html).toContain('Old action');
    expect(html).toContain('New action');

    const contentW = mmToPx(277), contentH = mmToPx(190);
    await page.setViewportSize({ width: Math.round(contentW), height: Math.round(contentH) + 400 });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate((w) => {
      document.getElementById('print').innerHTML = sheetHTML(1, true);
      document.querySelector('.sheet').style.width = w + 'px';
    }, contentW);
    await page.waitForTimeout(100);
    const height = await page.locator('.sheet').evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(contentH);
  });

  test('fridge sheet for a historical week uses only that week\'s goal and thresholds', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-07', change = '2026-09-14';
    const old = { ...blankState().settings.alerts, gMax: 180 };
    const next = { ...blankState().settings.alerts, gMax: 160 };
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 14, carbGoal: 30, alerts: next,
      carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }],
      alertHistory: [{ date: null, value: old }, { date: change, value: next }] } }));
    const sheets = await page.evaluate(() => [sheetHTML(1, false), sheetHTML(2, false)]);
    expect(sheets[0]).toContain('g, Limit 50 g');
    expect(sheets[0]).toContain('BZ ––180');
    expect(sheets[0]).not.toContain('BZ ––160');
    expect(sheets[1]).toContain('g, Limit 30 g');
    expect(sheets[1]).toContain('BZ ––160');
    expect(sheets[1]).not.toContain('BZ ––180');
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

  test('report retains a stopped medication, adherence, and dose-change identity', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -30), stopAt = addDays(start, 15);
    const days = {};
    for (let i = 0; i < 15; i++) {
      days[addDays(start, i)] = {
        sys1: i < 8 ? 120 : 130, dia1: i < 8 ? 80 : 84,
        meds: i < 10 ? { medA: i % 2 === 0 } : undefined,
      };
    }
    await seed(page, blankState({
      settings: { ...blankState().settings, start, days: 30, meds: [
        { id: 'medA', name: 'Testmed A', dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: stopAt },
      ] },
      days,
      doseChanges: [{ date: addDays(start, 7), medId: 'medA', oldDose: '5 mg', newDose: '10 mg' }],
    }));

    const result = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(reportHTML(), 'text/html');
      const medicationHeading = [...doc.querySelectorAll('h2')].find(h => h.textContent === 'Medikation');
      const medicationRow = medicationHeading.nextElementSibling.querySelector('tbody tr').textContent;
      const doseRow = medicationHeading.nextElementSibling.nextElementSibling.nextElementSibling.querySelector('tbody tr').textContent;
      return { medicationRow, doseRow, talkingPoints: generateTalkingPoints(), marker: doseMarkers()[0].label };
    });
    expect(result.medicationRow).toContain('Testmed A');
    expect(result.medicationRow).toContain('10 mg');
    expect(result.medicationRow).toContain('Medikament');
    expect(result.medicationRow).toContain('beendet ab');
    expect(result.medicationRow).toContain('50 %');
    expect(result.medicationRow).toContain('10 Tage erfasst');
    expect(result.doseRow).toContain('Testmed A');
    expect(result.marker).toContain('Testmed A');
    expect(result.talkingPoints.some(point => point.includes('Nach Anpassung von Testmed A'))).toBe(true);
  });

  test('report shows the last applicable dose and excludes out-of-lifecycle changes from derived outputs', async ({ page }) => {
    await gotoApp(page);
    const start = '2026-09-01', stopAt = '2026-09-15';
    const days = {};
    for (let i = 0; i < 22; i++) {
      days[addDays(start, i)] = { sys1: i < 15 ? 120 : 130, dia1: 80, meds: { medA: true } };
    }
    const changes = [
      { date: '2026-09-04', medId: 'medA', oldDose: '5 mg', newDose: '10 mg' },
      { date: stopAt, medId: 'medA', oldDose: '10 mg', newDose: '99 mg' },
    ];
    await seed(page, blankState({
      settings: { ...blankState().settings, start, days: 30, meds: [{ id: 'medA', name: 'Testmed A', dose: '99 mg', category: 'Medikament', startedAt: start, stoppedAt: stopAt }] },
      days, doseChanges: changes,
    }));
    const result = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(reportHTML(), 'text/html');
      const heading = [...doc.querySelectorAll('h2')].find(h => h.textContent === 'Medikation');
      const table = heading.nextElementSibling;
      const changeTable = table.nextElementSibling.nextElementSibling;
      return {
        header: table.querySelector('thead').textContent,
        row: table.querySelector('tbody tr').textContent,
        changes: [...changeTable.querySelectorAll('tbody tr')].map(row => row.textContent),
        markers: doseMarkers().map(marker => marker.label),
        points: generateTalkingPoints().filter(point => point.includes('Nach Anpassung')),
        raw: S.doseChanges,
      };
    });
    expect(result.header).toContain('Letzte Dosis');
    expect(result.row).toContain('Testmed A');
    expect(result.row).toContain('10 mg');
    expect(result.row).not.toContain('99 mg');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toContain('Testmed A');
    expect(result.changes[0]).toContain('10 mg');
    expect(result.markers).toEqual(['Testmed A → 10 mg']);
    expect(result.points).toEqual([]);
    expect(result.raw).toEqual(changes);
  });
});
