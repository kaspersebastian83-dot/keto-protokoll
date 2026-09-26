const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const period = (start, length, days = {}, weeks = {}) => blankState({
  settings: { ...blankState().settings, start, days: length }, days, weeks,
});
const entry = (data, archivedAt = today(), label = 'Synthetic earlier period') => ({ label, archivedAt, data });
const threeDays = (start, field, values) => Object.fromEntries(values.map((value, i) =>
  [addDays(start, i * 7), { [field]: value }]));
const row = (page, id) => page.locator(`#historicalComparison [data-compare="${id}"]`);

async function openComparison(page, state) {
  await gotoApp(page);
  await seed(page, state);
  await page.locator('nav button[data-tab="trend"]').click();
}

test.describe('Historical period comparison', () => {
  test('no archive gives a neutral unavailable state without a selector', async ({ page }) => {
    await openComparison(page, blankState());
    await expect(page.locator('#historicalComparison')).toContainText('Ein Vergleich wird verfügbar');
    await expect(page.locator('#historicalArchive')).toHaveCount(0);
    await expect(page.locator('#historicalComparison .period-compare-row')).toHaveCount(0);
  });

  test('one archive is selected and both weight sides use modeled endpoints', async ({ page }) => {
    const liveStart = addDays(today(), -20), oldStart = addDays(today(), -50);
    const live = period(liveStart, 28, threeDays(liveStart, 'w', [82, 80, 79]));
    live.archive = [entry(period(oldStart, 28, threeDays(oldStart, 'w', [84, 82, 81])), addDays(oldStart, 27))];
    await openComparison(page, live);
    await expect(page.locator('#historicalArchive')).toHaveValue('0');
    await expect(row(page, 'w').locator('.period-side-current')).toContainText('81,8 → 78,8 kg · Δ −3 kg');
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('83,8 → 80,8 kg · Δ −3 kg');
    await expect(row(page, 'w').locator('.period-side-current')).toContainText('3 Werte · 3 Wochen');
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
    const model = await page.evaluate(() => experimentPeriodComparison(S, S.archive[0]));
    expect(model.rows.find(r => r.id === 'w').current.start).toBeCloseTo(81.8333333333, 8);
    expect(model.rows.find(r => r.id === 'w').archived.start).toBeCloseTo(83.8333333333, 8);
    await expect(page.locator('#historicalComparison')).not.toContainText('Differenz zwischen Durchgängen');
  });

  test('several archives default to latest and selector updates only comparison content', async ({ page }) => {
    const oldStart = addDays(today(), -60), newerStart = addDays(today(), -40);
    const live = period(addDays(today(), -20), 28);
    live.archive = [
      entry(period(oldStart, 28, threeDays(oldStart, 'w', [90, 89, 88])), addDays(oldStart, 20), 'Earlier synthetic'),
      entry(period(newerStart, 28, threeDays(newerStart, 'w', [85, 84, 83])), addDays(newerStart, 20), 'Later synthetic'),
    ];
    await openComparison(page, live);
    await expect(page.locator('#historicalArchive')).toHaveValue('1');
    await expect(page.locator('#historicalComparisonContent')).toContainText('Later synthetic');
    await page.evaluate(() => {
      window.__overview = document.querySelector('#experimentOverview');
      window.__chart = document.querySelector('#v-trend .chart');
    });
    await page.locator('#historicalArchive').selectOption('0');
    await expect(page.locator('#historicalComparisonContent')).toContainText('Earlier synthetic');
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('90 → 88 kg');
    expect(await page.evaluate(() => document.querySelector('#experimentOverview') === window.__overview &&
      document.querySelector('#v-trend .chart') === window.__chart)).toBe(true);
    await page.locator('nav button[data-tab="day"]').click();
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(page.locator('#historicalArchive')).toHaveValue('0');
  });

  test('live future entries are excluded while its started partial week may count', async ({ page }) => {
    const liveStart = addDays(today(), -15), oldStart = addDays(today(), -50);
    const live = period(liveStart, 28, {
      [liveStart]: { w: 82 }, [addDays(liveStart, 7)]: { w: 80 },
      [addDays(liveStart, 14)]: { w: 78 }, [addDays(liveStart, 16)]: { w: 40 },
    });
    live.archive = [entry(period(oldStart, 28, threeDays(oldStart, 'w', [85, 84, 83])), addDays(oldStart, 20))];
    await openComparison(page, live);
    await expect(row(page, 'w').locator('.period-side-current')).toContainText('3 Werte · 3 Wochen');
    await expect(row(page, 'w').locator('.period-side-current')).toContainText('82 → 78 kg');
  });

  test('archive cutoff includes archivedAt but excludes later pre-entered days', async ({ page }) => {
    const start = addDays(today(), -35), archivedAt = addDays(start, 14);
    const days = { [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 },
      [archivedAt]: { w: 78 }, [addDays(start, 15)]: { w: 10 }, [addDays(start, 21)]: { w: 5 } };
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry(period(start, 28, days), archivedAt)];
    await openComparison(page, live);
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('82 → 78 kg');
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
    expect(await page.evaluate(() => experimentPeriodComparison(S, S.archive[0]).archivedAsOf)).toBe(archivedAt);
  });

  test('configured end caps an archive date later than the period', async ({ page }) => {
    const start = addDays(today(), -50), end = addDays(start, 20);
    const days = { ...threeDays(start, 'w', [82, 80, 78]), [addDays(start, 21)]: { w: 5 } };
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry(period(start, 21, days), today())];
    await openComparison(page, live);
    expect(await page.evaluate(() => experimentPeriodComparison(S, S.archive[0]).archivedAsOf)).toBe(end);
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
  });

  test('short stored periods use the app\'s seven-day minimum effective duration', async ({ page }) => {
    const start = addDays(today(), -20), effectiveEnd = addDays(start, 6);
    const archived = period(start, 5, { [start]: { w: 82 }, [effectiveEnd]: { w: 78 },
      [addDays(start, 7)]: { w: 10 } });
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry(archived, addDays(start, 10))];
    await openComparison(page, live);
    const observed = await page.evaluate(() => {
      const original = overviewWeeklyPairs;
      let archivedDays;
      overviewWeeklyPairs = (id, source, days, weeks, range) => {
        if (id === 'w' && source === 'day' && range.start === S.archive[0].data.settings.start)
          archivedDays = days.map(({ date, day }) => ({ date, weight: day.w ?? null }));
        return original(id, source, days, weeks, range);
      };
      try { return { cutoff: experimentPeriodComparison(S, S.archive[0]).archivedAsOf, archivedDays }; }
      finally { overviewWeeklyPairs = original; }
    });
    expect(observed.cutoff).toBe(effectiveEnd);
    expect(observed.archivedDays).toEqual(Array.from({ length: 7 }, (_, i) =>
      ({ date: addDays(start, i), weight: i === 0 ? 82 : i === 6 ? 78 : null })));
    await expect(page.locator('#historicalComparisonContent')).toContainText('noch nicht genügend Wochen');
  });

  test('archive date equal to effective end includes observations on that date', async ({ page }) => {
    const start = addDays(today(), -40), effectiveEnd = addDays(start, 20);
    const days = { [start]: { w: 82 }, [addDays(start, 7)]: { w: 80 },
      [effectiveEnd]: { w: 78 }, [addDays(start, 21)]: { w: 10 } };
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry(period(start, 21, days), effectiveEnd)];
    await openComparison(page, live);
    expect(await page.evaluate(() => experimentPeriodComparison(S, S.archive[0]).archivedAsOf)).toBe(effectiveEnd);
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('82 → 78 kg');
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
  });

  test('archive partial final week and zero-valued daily and weekly data count', async ({ page }) => {
    const start = addDays(today(), -40), archivedAt = addDays(start, 15);
    const archived = period(start, 16, threeDays(start, 'g', [0, 10, 20]),
      { 1: { sleep: 0 }, 2: { sleep: 4 }, 3: { sleep: 8 } });
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry(archived, archivedAt)];
    await openComparison(page, live);
    await expect(row(page, 'g').locator('.period-side-archive')).toContainText('0 → 20 mg/dl · Δ +20 mg/dl');
    await expect(row(page, 'sleep').locator('.period-side-archive')).toContainText('0 → 8 h · Δ +8 h');
    await expect(row(page, 'g').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
    await expect(row(page, 'sleep').locator('.period-side-archive')).toContainText('3 Werte · 3 Wochen');
  });

  test('archived systolic and diastolic trends include migrated legacy BP', async ({ page }) => {
    const start = addDays(today(), -50);
    const days = Object.fromEntries([0, 7, 14].map((offset, i) =>
      [addDays(start, offset), { sys: 130 - i * 5, dia: 82 - i * 3 }]));
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry({ settings: { start, days: 21 }, days }, addDays(start, 20))];
    await openComparison(page, live);
    await expect(row(page, 'sys').locator('.period-side-archive')).toContainText('130 → 120 mmHg');
    await expect(row(page, 'dia').locator('.period-side-archive')).toContainText('82 → 76 mmHg');
    expect(await page.evaluate(() => S.archive[0].data.days[S.archive[0].data.settings.start]))
      .toMatchObject({ sys1: 130, dia1: 82, sys: 130, dia: 82 });
  });

  test('one-sided metrics remain visible and both unavailable sides give a neutral empty state', async ({ page }) => {
    const liveStart = addDays(today(), -20), oldStart = addDays(today(), -50);
    const live = period(liveStart, 28, threeDays(liveStart, 'w', [82, 80, 78]));
    live.archive = [entry(period(oldStart, 28, {},
      { 1: { waist: 90 }, 2: { waist: 88 }, 3: { waist: 86 } }), addDays(oldStart, 20))];
    await openComparison(page, live);
    await expect(row(page, 'w').locator('.period-side-archive')).toContainText('Keine Trendberechnung möglich');
    await expect(row(page, 'waist').locator('.period-side-current')).toContainText('Keine Trendberechnung möglich');
    expect(await page.locator('#historicalComparison .period-compare-row').evaluateAll(nodes => nodes.map(node => node.dataset.compare)))
      .toEqual(['w', 'waist']);
    await seed(page, blankState({ archive: [entry(period(oldStart, 28,
      { [oldStart]: { w: 82 }, [addDays(oldStart, 7)]: { w: 80 } }), addDays(oldStart, 20))] }));
    await page.locator('nav button[data-tab="trend"]').click();
    await expect(page.locator('#historicalComparisonContent')).toContainText('Für diesen Vergleich liegen noch nicht genügend Wochen mit Daten vor.');
    await expect(page.locator('#historicalComparison .period-compare-row')).toHaveCount(0);
  });

  test('all fourteen metric rows retain the summary order without a between-period score', async ({ page }) => {
    const start = addDays(today(), -30), days = {}, weeks = {};
    for(let i=0;i<3;i++){
      days[addDays(start,i*7)]={ w:80-i,g:90+i,k:1+i/10,sys:130-i,dia:80-i,
        p:70+i,c:30+i,en:3,hu:2 };
      weeks[i+1]={ waist:90-i,rhr:60+i,sleep:7,stress:30+i,steps:5000+i*100 };
    }
    const live = period(start, 28, days, weeks);
    live.archive = [entry(period(start, 28, days, weeks), addDays(start, 20))];
    await openComparison(page, live);
    expect(await page.locator('#historicalComparison .period-compare-row').evaluateAll(nodes=>nodes.map(n=>n.dataset.compare)))
      .toEqual(['w','g','k','sys','dia','p','c','en','hu','waist','rhr','sleep','stress','steps']);
    const text = await page.locator('#historicalComparison').innerText();
    expect(text).not.toMatch(/verbessert|verschlechtert|besser|schlechter|gewonnen|Gewinner|erfolgreich|Score|Punktzahl|Korrelation|aufgrund der Ernährung|durch Keto/i);
    expect(text).toContain('ohne statistische Signifikanz oder Ursachen zu belegen');
  });

  test('malformed, invalid-duration, and future-version archives do not break Verlauf', async ({ page }) => {
    const oldStart = addDays(today(), -50), liveStart = addDays(today(), -20);
    const live = period(liveStart, 28, threeDays(liveStart, 'w', [82, 80, 78]));
    live.archive = [
      entry({ dataVersion: 6, settings: { start: oldStart, days: 28 }, days: { [oldStart]: null }, weeks: {} }, addDays(oldStart, 20), 'Malformed'),
      entry({ ...period(oldStart, 28, threeDays(oldStart, 'w', [90, 80, 70])), dataVersion: 999 }, addDays(oldStart, 20), 'Future'),
      entry({ dataVersion: 6, settings: { start: oldStart, days: true },
        days: threeDays(oldStart, 'w', [90, 80, 70]), weeks: {} }, addDays(oldStart, 20), 'Invalid duration'),
    ];
    await openComparison(page, live);
    await expect(page.locator('#historicalComparisonContent')).toContainText('nicht ausgewertet werden');
    await page.locator('#historicalArchive').selectOption('1');
    await expect(page.locator('#historicalComparisonContent')).toContainText('nicht ausgewertet werden');
    await page.locator('#historicalArchive').selectOption('0');
    await expect(page.locator('#historicalComparisonContent')).toContainText('nicht ausgewertet werden');
    await expect(page.locator('#experimentOverview')).toBeVisible();
    await expect(page.locator('#experimentSummary')).toBeVisible();
    await expect(page.locator('#dataBasis')).toBeVisible();
    await expect(page.locator('#v-trend .chart').first()).toBeVisible();
    await page.locator('#cmpA').selectOption('w');
    await expect(page.locator('#cmpChart')).toContainText('Gewicht');
  });

  test('archive labels are escaped in options and content', async ({ page }) => {
    const start = addDays(today(), -40), label = `<img src=x onerror="window.bad=true"> & 'literal'`;
    const live = period(addDays(today(), -10), 28);
    live.archive = [entry(period(start, 28, threeDays(start, 'w', [82, 80, 78])), addDays(start, 20), label)];
    await openComparison(page, live);
    await expect(page.locator('#historicalArchive option')).toHaveText(label);
    await expect(page.locator('#historicalComparisonContent')).toContainText(label);
    await expect(page.locator('#historicalComparison img')).toHaveCount(0);
    expect(await page.evaluate(() => window.bad)).toBeUndefined();
  });

  test('opening and selecting leave S, archive, storage keys, and backup metadata unchanged', async ({ page }) => {
    const oldStart = addDays(today(), -60), liveStart = addDays(today(), -20);
    const live = period(liveStart, 28, threeDays(liveStart, 'w', [82, 80, 78]));
    live.settings.lastBackup = addDays(today(), -1);
    live.archive = [entry(period(oldStart, 28, threeDays(oldStart, 'w', [90, 80, 70])), addDays(oldStart, 20)),
      entry(period(oldStart, 28, threeDays(oldStart, 'w', [85, 84, 83])), addDays(oldStart, 20))];
    await gotoApp(page);
    await seed(page, live);
    await page.evaluate(() => localStorage.setItem(RECOVERY_KEY, 'synthetic recovery sentinel'));
    const before = await page.evaluate(() => { window.__savedS = S; return { live: JSON.stringify(S), archive: JSON.stringify(S.archive),
      key: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY), lastBackup: S.settings.lastBackup }; });
    await page.locator('nav button[data-tab="trend"]').click();
    await page.locator('#historicalArchive').selectOption('0');
    expect(await page.evaluate(() => ({ sameRef: S === window.__savedS, live: JSON.stringify(S), archive: JSON.stringify(S.archive),
      key: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY), lastBackup: S.settings.lastBackup })))
      .toEqual({ sameRef: true, live: before.live, archive: before.archive, key: before.key,
        recovery: before.recovery, lastBackup: before.lastBackup });
  });

  test('interactive comparison never swaps S or invokes report and talking-point functions', async ({ page }) => {
    const start = addDays(today(), -30), live = period(start, 28, threeDays(start, 'w', [82, 80, 78]));
    live.archive = [entry(period(start, 28, threeDays(start, 'w', [90, 80, 70])), addDays(start, 20))];
    await gotoApp(page);
    await seed(page, live);
    await page.evaluate(() => {
      window.__live = S;
      window.__summary = experimentSummary;
      window.__report = reportHTML;
      window.__talk = generateTalkingPoints;
      window.__archiveReport = viewArchivedReport;
      experimentSummary = (state, asOf) => {
        if(S !== window.__live)throw new Error('Global S was replaced');
        return window.__summary(state, asOf);
      };
      reportHTML = () => { throw new Error('reportHTML called'); };
      generateTalkingPoints = () => { throw new Error('generateTalkingPoints called'); };
      viewArchivedReport = () => { throw new Error('viewArchivedReport called'); };
    });
    try {
      await page.locator('nav button[data-tab="trend"]').click();
      await expect(row(page, 'w')).toBeVisible();
      await page.locator('#historicalArchive').selectOption('0');
      await expect(row(page, 'w')).toBeVisible();
      expect(await page.evaluate(() => S === window.__live)).toBe(true);
    } finally {
      await page.evaluate(() => {
        experimentSummary = window.__summary;
        reportHTML = window.__report;
        generateTalkingPoints = window.__talk;
        viewArchivedReport = window.__archiveReport;
        delete window.__live; delete window.__summary; delete window.__report;
        delete window.__talk; delete window.__archiveReport;
      });
    }
  });

  test('existing Verlauf panels, seven charts, and two-variable selector remain functional', async ({ page }) => {
    const start = addDays(today(), -20), days = {
      [start]: { c: 30, k: 1, w: 82 }, [addDays(start, 7)]: { c: 40, k: 1.1, w: 80 },
      [addDays(start, 14)]: { c: 50, k: 1.2, w: 78 },
    };
    const live = period(start, 28, days);
    live.archive = [entry(period(start, 28, days), today())];
    await openComparison(page, live);
    const order = await page.locator('#v-trend > *').evaluateAll(nodes => nodes.map(node => node.id || node.querySelector('h2')?.textContent));
    expect(order.slice(0,4)).toEqual(['experimentOverview','experimentSummary','historicalComparison','dataBasis']);
    expect(order.at(-1)).toBe('Vergleich zweier Werte');
    await expect(page.locator('#experimentOverview')).toBeVisible();
    await expect(page.locator('#experimentSummary')).toBeVisible();
    await expect(page.locator('#dataBasis')).toBeVisible();
    const captions = await page.locator('#v-trend .chart figcaption').allTextContents();
    expect(captions.slice(0,7).map(text => text.split(' (')[0])).toEqual([
      'Gewicht','Blutzucker nüchtern','Ketone','Blutdruck','Kohlenhydrate','Ruhepuls','Bauchumfang',
    ]);
    await expect(page.locator('#cmpA')).toHaveValue('c');
    await expect(page.locator('#cmpB')).toHaveValue('k');
    await page.locator('#cmpA').selectOption('w');
    await expect(page.locator('#cmpChart')).toContainText('Gewicht');
  });

  test('release and storage metadata remain synchronized at 1.7.2', async ({ page }) => {
    await gotoApp(page);
    expect(await page.evaluate(() => ({ version: VERSION, schema: DATA_VERSION, key: KEY, recovery: RECOVERY_KEY })))
      .toEqual({ version: '1.7.2', schema: 6, key: 'ketoProtokoll_v1', recovery: 'ketoProtokoll_recovery_v1' });
  });
});
