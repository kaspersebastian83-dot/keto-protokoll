const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { gotoApp, seed, blankState, today } = require('./helpers');

const date = '2026-09-01';
const row = (name, value, unit = 'U/l', range = '') => [name, value, unit, range].join('\t');

async function openImporter(page, state = blankState()) {
  await gotoApp(page);
  await seed(page, state);
  await page.locator('nav button[data-tab="lab"]').click();
  await page.locator('#labImportOpen').click();
  await expect(page.locator('#labImport')).toBeVisible();
}
async function check(page, text, labDate = date) {
  await page.locator('#labImportDate').fill(labDate);
  await page.locator('#labImportText').fill(text);
  await page.locator('#labImportCheck').click();
}
async function apply(page) {
  if (await page.locator('#labImportReplace').count()) await page.locator('#labImportReplace').check();
  await page.locator('#labImportApply').click();
}

test.describe('Laboratory baseline panel import', () => {
  test('dialog opens with blank date and cancel or Escape discards every draft and restores focus', async ({ page }) => {
    await openImporter(page);
    await expect(page.locator('#labImportDate')).toBeFocused();
    await expect(page.locator('#labImportDate')).toHaveValue('');
    await expect(page.locator('#labImportApply')).toBeDisabled();
    const before = await page.evaluate(() => ({ state: JSON.stringify(S), stored: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY) }));
    for (const close of ['button', 'Escape']) {
      await check(page, row('Synthetic parameter', '1,3', 'U/l', '< 5'));
      await expect(page.locator('#labImportApply')).toBeEnabled();
      if (close === 'button') await page.locator('#labImportClose').click();
      else await page.keyboard.press('Escape');
      await expect(page.locator('#labImport')).toBeHidden();
      await expect(page.locator('#labImportOpen')).toBeFocused();
      expect(await page.evaluate(() => ({ state: JSON.stringify(S), stored: localStorage.getItem(KEY), recovery: localStorage.getItem(RECOVERY_KEY) }))).toEqual(before);
      await page.locator('#labImportOpen').click();
      await expect(page.locator('#labImportText')).toHaveValue('');
      await expect(page.locator('#labImportPreview')).toBeEmpty();
    }
  });

  test('explicit valid date and at least one valid row are required; editing after review invalidates it', async ({ page }) => {
    await openImporter(page);
    await page.locator('#labImportText').fill(row('Synthetic parameter', '2'));
    await page.locator('#labImportCheck').click();
    await expect(page.locator('#labImportStatus')).toContainText('Labor-Datum');
    await expect(page.locator('#labImportApply')).toBeDisabled();
    await page.locator('#labImportDate').evaluate(el => { el.type = 'text'; el.value = '2026-02-30'; });
    await page.locator('#labImportCheck').click();
    await expect(page.locator('#labImportApply')).toBeDisabled();
    await page.locator('#labImportDate').fill(date);
    await page.locator('#labImportCheck').click();
    await expect(page.locator('#labImportApply')).toBeEnabled();
    await page.locator('#labImportText').fill(row('Synthetic parameter', '3'));
    await expect(page.locator('#labImportApply')).toBeDisabled();
    await expect(page.locator('#labImportStatus')).toContainText('erneut prüfen');
  });

  test('strict lab numbers accept comma, dot and signed values but reject partial, nonfinite and ambiguous forms', async ({ page }) => {
    await openImporter(page);
    const values = await page.evaluate(() => ['1', '1.3', '1,3', '65.5', '65,5', '0.70', '0,70', '-1,3',
      '1.000', '1,000', '1.2.3', '12 mg', 'NaN', 'Infinity', '12x'].map(value => strictLabNumber(value)));
    expect(values.slice(0, 8)).toEqual([1, 1.3, 1.3, 65.5, 65.5, 0.7, 0.7, -1.3]);
    expect(values.slice(8)).toEqual(Array(7).fill(null));
    await check(page, row('Synthetic parameter', '1.000'));
    await expect(page.locator('#labImportPreview')).toContainText('ungültiger oder mehrdeutiger Wert');
    await expect(page.locator('#labImportApply')).toBeDisabled();
  });

  test('range operators and exact equality boundaries work without interpreting unknown text', async ({ page }) => {
    await openImporter(page);
    const values = await page.evaluate(() => ({
      less: [parseRange('< 200'), isOutOfRange(200, '< 200'), isOutOfRange(199, '< 200')],
      lessEqual: [parseRange('<= 200'), isOutOfRange(200, '<= 200')],
      greater: [parseRange('> 60'), isOutOfRange(60, '> 60'), isOutOfRange(61, '> 60')],
      greaterEqual: [parseRange('>= 60'), isOutOfRange(60, '>= 60')],
      interval: [parseRange('4,2 - 9,1'), isOutOfRange(4.2, '4,2 - 9,1'), isOutOfRange(9.1, '4,2 - 9,1')],
      unknown: [parseRange('lab-specific note'), isOutOfRange(999, 'lab-specific note')],
    }));
    expect(values.less).toEqual([{ min: null, max: 200 }, true, false]);
    expect(values.lessEqual).toEqual([{ min: null, max: 200 }, false]);
    expect(values.greater).toEqual([{ min: 60, max: null }, true, false]);
    expect(values.greaterEqual).toEqual([{ min: 60, max: null }, false]);
    expect(values.interval).toEqual([{ min: 4.2, max: 9.1 }, false, false]);
    expect(values.unknown).toEqual([{ min: null, max: null }, false]);
  });

  test('optional header, original reference text, alias matching and new unitless ratio are imported', async ({ page }) => {
    const names = ['Glukose nüchtern', 'GPT (ALT)', 'GOT (AST)', 'Gamma-GT', 'LDL-Cholesterin', 'HDL-Cholesterin', 'TSH', 'Kreatinin'];
    const labs = names.map(name => ({ name, unit: 'old', range: '', base: '', end: '' }));
    await openImporter(page, blankState({ labs }));
    const input = ['Parameter\tWert\tEinheit\tReferenzbereich',
      row('Glucose', '90', 'mg/dl', '< 100'), row('ALT', '44', 'U/l', '< 50'),
      row('AST', '33', 'U/l', '<= 50'), row('GGT', '20', 'U/l', '5 - 40'),
      row('LDL', '137', 'mg/dl', '< 130'), row('HDL', '60', 'mg/dl', '> 40'),
      row('TSH (basal)', '1,3', 'mU/l', '0,70 - 4,20'), row('Creatinin', '0.8', 'mg/dl', 'lab-specific note'),
      row('LDL/HDL ratio', '2,3', '', '')].join('\n');
    await check(page, input);
    await expect(page.locator('#labImportPreview tbody tr')).toHaveCount(9);
    await expect(page.locator('#labImportPreview')).toContainText('neuer Parameter');
    await apply(page);
    const result = await page.evaluate(() => ({ labs: S.labs, date: S.labDates.base, stored: JSON.parse(localStorage.getItem(KEY)).labs }));
    expect(result.date).toBe(date);
    expect(result.labs).toEqual(result.stored);
    expect(result.labs).toHaveLength(9);
    expect(result.labs[0]).toEqual({ name: 'Glukose nüchtern', unit: 'mg/dl', range: '< 100', base: '90', end: '' });
    expect(result.labs[6].range).toBe('0,70 - 4,20');
    expect(result.labs[8]).toEqual({ name: 'LDL/HDL ratio', unit: '', range: '', base: '2,3', end: '' });
    expect(result.labs[7].range).toBe('lab-specific note');
    await expect(page.locator('.labtbl input.oor')).toHaveCount(1);
  });

  test('duplicate names, alias collisions and ambiguous existing rows block confirmation', async ({ page }) => {
    await openImporter(page, blankState({ labs: [
      { name: 'GPT (ALT)', unit: 'U/l', range: '', base: '', end: '' },
      { name: 'Glukose', unit: 'mg/dl', range: '', base: '', end: '' },
      { name: 'Glukose nüchtern', unit: 'mg/dl', range: '', base: '', end: '' },
    ] }));
    for (const input of [
      [row('ALT', '30'), row('ALT', '31')].join('\n'),
      [row('ALT', '30'), row('GPT', '31')].join('\n'),
      row('Glucose', '91', 'mg/dl'),
    ]) {
      await check(page, input);
      await expect(page.locator('#labImportApply')).toBeDisabled();
      await expect(page.locator('#labImportPreview')).toContainText(/Konflikt|mehrdeutig/);
    }
  });

  test('replacement requires explicit consent, clears unmentioned baseline values and preserves follow-up', async ({ page }) => {
    const labs = [
      { name: 'Natrium', unit: 'mmol/l', range: '136 - 145', base: '140', end: '142' },
      { name: 'Old synthetic parameter', unit: 'U/l', range: '< 50', base: '15', end: '18' },
    ];
    await openImporter(page, blankState({ labs, labDates: { base: '2026-08-01', end: '2026-09-20' } }));
    await check(page, row('Natrium', '141', 'mmol/l', '136 - 145'));
    await expect(page.locator('#labImportStatus')).toContainText('2 vorhandene Ausgangswerte');
    await expect(page.locator('#labImportStatus')).toContainText('1 fehlen');
    await expect(page.locator('#labImportPreview')).toContainText('wird beim Ersetzen entfernt');
    await expect(page.locator('#labImportPreview')).toContainText('140');
    await expect(page.locator('#labImportApply')).toBeDisabled();
    await page.locator('#labImportReplace').check();
    await expect(page.locator('#labImportApply')).toBeEnabled();
    await page.locator('#labImportApply').click();
    expect(await page.evaluate(() => ({ labs: S.labs, dates: S.labDates }))).toEqual({
      labs: [{ ...labs[0], base: '141' }, { ...labs[1], base: '' }],
      dates: { base: date, end: '2026-09-20' },
    });
  });

  test('existing follow-up with changed unit or range blocks import, while equal fields pass', async ({ page }) => {
    const original = { name: 'Natrium', unit: 'mmol/l', range: '136 - 145', base: '', end: '142' };
    await openImporter(page, blankState({ labs: [original] }));
    for (const input of [row('Natrium', '141', 'mg/dl', '136 - 145'), row('Natrium', '141', 'mmol/l', '135 - 145')]) {
      await check(page, input);
      await expect(page.locator('#labImportApply')).toBeDisabled();
      await expect(page.locator('#labImportPreview')).toContainText('Abschlusswert vorhanden');
    }
    await check(page, row('Natrium', '141', 'mmol/l', ' 136 - 145 '));
    await expect(page.locator('#labImportApply')).toBeEnabled();
    await apply(page);
    expect(await page.evaluate(() => S.labs[0])).toEqual({ ...original, base: '141', range: ' 136 - 145 ' });
  });

  test('incomplete legacy unit and range fields remain reviewable when a follow-up exists', async ({ page }) => {
    await openImporter(page, blankState({
      labs: [{ name: 'Synthetic parameter', unit: '', range: '', base: '', end: '8' }],
    }));
    await page.evaluate(() => { S.labs[0].unit = undefined; S.labs[0].range = null; });
    await check(page, row('Synthetic parameter', '5', 'U/l', '< 10'));
    await expect(page.locator('#labImportPreview')).toContainText('Abschlusswert vorhanden');
    await expect(page.locator('#labImportApply')).toBeDisabled();
  });

  test('stale preview and failed persistence never partially mutate live state', async ({ page }) => {
    await openImporter(page);
    await check(page, row('Synthetic parameter', '5'));
    const before = await page.evaluate(() => JSON.stringify(S));
    await page.evaluate(() => { S.labDates.base = '2026-08-02'; });
    await page.locator('#labImportApply').click();
    await expect(page.locator('#labImportStatus')).toContainText('erneut prüfen');
    expect(await page.evaluate(() => S.labs)).toEqual([]);
    await page.evaluate(() => { S.labDates.base = ''; });
    await page.locator('#labImportCheck').click();
    await page.evaluate(() => {
      window.labOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === KEY) throw new Error('Synthetic quota failure');
        return window.labOriginalSetItem.call(this, key, value);
      };
    });
    await page.locator('#labImportApply').click();
    await expect(page.locator('#labImportStatus')).toContainText('Speichern fehlgeschlagen');
    expect(await page.evaluate(() => JSON.stringify(S))).toBe(before);
    await page.evaluate(() => { Storage.prototype.setItem = window.labOriginalSetItem; });
  });

  test('input limits and malformed rows are visibly rejected', async ({ page }) => {
    await openImporter(page);
    for (const input of [row('', '1'), row('Synthetic parameter', ''), row('Synthetic parameter', '1 mg'),
      row('X'.repeat(121), '1'), row('Synthetic parameter', '1', 'U'.repeat(41)), row('Synthetic parameter', '1', 'U/l', 'R'.repeat(121))]) {
      await check(page, input);
      await expect(page.locator('#labImportApply')).toBeDisabled();
      await expect(page.locator('#labImportStatus')).toContainText('mit Fehlern');
    }
    await check(page, Array.from({ length: 101 }, (_, i) => row(`Synthetic ${i}`, '1')).join('\n'));
    await expect(page.locator('#labImportStatus')).toContainText('Höchstens 100 Zeilen');
    await check(page, 'X'.repeat(30001));
    await expect(page.locator('#labImportStatus')).toContainText('Höchstens 30000 Zeichen');
  });

  test('HTML-like fields stay text in preview, Lab view and doctor report', async ({ page }) => {
    await openImporter(page);
    const name = '<img src=x onerror=alert(1)>', unit = '<script>alert(1)</script>', range = '<script>alert(1)</script>';
    await check(page, row(name, '3', unit, range));
    await expect(page.locator('#labImportPreview')).toContainText(name);
    expect(await page.locator('#labImportPreview img, #labImportPreview script').count()).toBe(0);
    await apply(page);
    await expect(page.locator('.labtbl input[data-lk="name"]')).toHaveValue(name);
    expect(await page.locator('#v-lab img, #v-lab script').count()).toBe(0);
    const report = await page.evaluate(() => reportHTML());
    const safe = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { text: doc.body.textContent, injected: doc.querySelectorAll('img, script').length };
    }, report);
    expect(safe.text).toContain(name);
    expect(safe.text).toContain(unit);
    expect(safe.text).toContain(range);
    expect(safe.injected).toBe(0);
  });

  test('confirmed values round-trip through JSON backup and raw paste does not enter user state', async ({ page }) => {
    await openImporter(page);
    const raw = row('Synthetic parameter', '12,4', 'U/l', '< 20');
    await check(page, raw);
    const before = await page.evaluate(() => JSON.stringify(S) + localStorage.getItem(KEY));
    expect(before).not.toContain(JSON.stringify(raw));
    await apply(page);
    await page.locator('nav button[data-tab="set"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exp').click()]);
    const exported = await fs.readFile(await download.path(), 'utf8');
    expect(exported).not.toContain(JSON.stringify(raw));
    expect(JSON.parse(exported).labs[0].base).toBe('12,4');
    await seed(page, blankState());
    await page.locator('nav button[data-tab="set"]').click();
    page.once('dialog', dialog => dialog.accept());
    await page.setInputFiles('#importFile', { name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await expect.poll(() => page.evaluate(() => S.labs[0]?.base)).toBe('12,4');
    expect(await page.evaluate(() => ({ labs: S.labs, date: S.labDates.base }))).toEqual({
      labs: [{ name: 'Synthetic parameter', unit: 'U/l', range: '< 20', base: '12,4', end: '' }], date,
    });
  });

  test('archive and new round retain the established lab behavior; report includes confirmed rows, fridge sheet does not', async ({ page }) => {
    await openImporter(page);
    await check(page, [row('Synthetic parameter', '12', 'U/l', '< 20'), row('Second synthetic parameter', '4', 'U/l', '1 - 5')].join('\n'));
    await apply(page);
    const before = await page.evaluate(() => ({ report: reportHTML(), sheet: sheetHTML(1, true), version: VERSION, dataVersion: DATA_VERSION, keys: [KEY, RECOVERY_KEY] }));
    expect(before.report).toContain('Synthetic parameter');
    expect(before.sheet).not.toContain('Synthetic parameter');
    expect(before.version).toBe('1.10.1');
    expect(before.dataVersion).toBe(7);
    expect(before.keys).toEqual(['ketoProtokoll_v1', 'ketoProtokoll_recovery_v1']);
    await page.evaluate(() => startNewRound());
    const archivedReport = await page.evaluate(() => { window.print = () => {}; viewArchivedReport(0); return document.getElementById('print').textContent; });
    expect(archivedReport).toContain('Second synthetic parameter');
    expect(await page.evaluate(() => ({ archived: S.archive[0].data.labs, archivedDate: S.archive[0].data.labDates.base,
      live: S.labs, liveDate: S.labDates.base }))).toEqual({
      archived: [{ name: 'Synthetic parameter', unit: 'U/l', range: '< 20', base: '12', end: '' },
        { name: 'Second synthetic parameter', unit: 'U/l', range: '1 - 5', base: '4', end: '' }],
      archivedDate: date,
      live: [{ name: 'Synthetic parameter', unit: 'U/l', range: '< 20', base: '', end: '' },
        { name: 'Second synthetic parameter', unit: 'U/l', range: '1 - 5', base: '', end: '' }],
      liveDate: today(),
    });
  });

  test('importing makes no network request', async ({ page, context }) => {
    await openImporter(page);
    const requests = [];
    context.on('request', request => requests.push(request.url()));
    await check(page, row('Synthetic parameter', '12'));
    await apply(page);
    expect(requests).toEqual([]);
  });
});
