const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

async function open(page, state = blankState()) {
  await gotoApp(page);
  await seed(page, state);
  await page.locator('#carbCalcOpen').click();
  await expect(page.locator('#carbCalc')).toBeVisible();
}

async function fillRow(page, index, amount, per100, name) {
  const row = page.locator('[data-calc-row]').nth(index);
  if (name !== undefined) await row.locator('[data-calc-field="name"]').fill(name);
  await row.locator('[data-calc-field="amount"]').fill(amount);
  await row.locator('[data-calc-field="per100"]').fill(per100);
  return row;
}

const transfer = (page, mode) => page.locator(`[data-calc-transfer="${mode}"]`);

test.describe('Carb calculator', () => {
  test('opens a dated modal with one empty row and explicit EU-label wording', async ({ page }) => {
    await open(page);
    await expect(page.locator('#carbCalc')).toHaveAttribute('aria-labelledby', 'carbCalcTitle');
    await expect(page.locator('#carbCalcDate')).toContainText('KH berechnen für');
    await expect(page.locator('#carbCalcRows [data-calc-row]')).toHaveCount(1);
    await expect(page.locator('#carbCalcHelp')).toContainText('Ballaststoffe nicht zusätzlich abziehen');
    await expect(page.locator('#carbCalcRows label')).toContainText(['Lebensmittel (optional)', 'Verzehrte Menge (g)', 'Kohlenhydrate laut Packung (g je 100 g)']);
    await expect(page.locator('#carbCalcRows [data-calc-field="amount"]')).toBeFocused();
    await expect(transfer(page, 'take')).toHaveCount(0);
    await expect(page.locator('#carbCalcTotal')).toContainText('alle Zeilen vervollständigen');
  });

  test('adds and removes named ingredients without persisting food names', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '100', '8', 'Synthetic food A');
    await page.locator('#carbCalcAdd').click();
    await expect(page.locator('#carbCalcRows [data-calc-row]')).toHaveCount(2);
    await fillRow(page, 1, '50', '4', 'Synthetic food B');
    await expect(page.locator('#carbCalcTotal')).toContainText('10,0 g');
    await expect(page.locator('[data-calc-row]').nth(1).locator('[data-calc-remove]')).toHaveAttribute('aria-label', 'Zutat 2 Synthetic food B entfernen');
    await page.locator('[data-calc-row]').first().locator('[data-calc-remove]').click();
    await expect(page.locator('#carbCalcRows [data-calc-row]')).toHaveCount(1);
    await expect(page.locator('#carbCalcTotal')).toContainText('2,0 g');
    expect(await page.evaluate(() => JSON.stringify(S))).not.toContain('Synthetic food');
    expect(await page.evaluate(() => localStorage.getItem(KEY))).not.toContain('Synthetic food');
  });

  test('accepts comma and dot decimals and sums unrounded portions before one transfer rounding', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '125', '7,3'); // 9.125 g
    await page.locator('#carbCalcAdd').click();
    await fillRow(page, 1, '0.9', '5'); // 0.045 g
    await expect(page.locator('[data-calc-row]').first().locator('output')).toHaveText('9,1 g');
    await expect(page.locator('[data-calc-row]').nth(1).locator('output')).toHaveText('<0,1 g');
    await expect(page.locator('#carbCalcTotal')).toContainText('9,2 g');
    await transfer(page, 'take').click();
    expect(await page.evaluate(() => S.days[today()].c)).toBe(9.2);
    await page.reload();
    await expect(page.locator('#f_c')).toHaveValue('9,2');
  });

  test('explicit zero amount and zero-carb food are valid recorded values', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '0,0', '30');
    await expect(page.locator('#carbCalcTotal')).toContainText('0,0 g');
    await transfer(page, 'take').click();
    expect(await page.evaluate(() => S.days[today()].c)).toBe(0);
    await page.locator('#carbCalcOpen').click();
    await fillRow(page, 0, '100', '0.0');
    await expect(page.locator('#carbCalcTotal')).toContainText('0,0 g');
    await expect(transfer(page, 'add')).toBeVisible();
    await expect(transfer(page, 'replace')).toBeVisible();
  });

  test('tiny positive result says less than 0.1 g and identifies rounded transfer value', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '1', '1');
    await expect(page.locator('#carbCalcTotal')).toContainText('<0,1 g');
    await expect(page.locator('#carbCalcRound')).toContainText('Übertragungswert auf 0,1 g gerundet: 0,0 g');
    await transfer(page, 'take').click();
    expect(await page.evaluate(() => S.days[today()].c)).toBe(0);
  });

  test('incomplete rows prevent transfer and never show NaN or Infinity', async ({ page }) => {
    await open(page);
    await page.locator('[data-calc-field="amount"]').fill('100');
    await expect(transfer(page, 'take')).toHaveCount(0);
    await page.locator('[data-calc-field="amount"]').fill('');
    await page.locator('[data-calc-field="per100"]').fill('10');
    await expect(transfer(page, 'take')).toHaveCount(0);
    await expect(page.locator('#carbCalc')).not.toContainText(/NaN|Infinity/);
    expect(await page.evaluate(() => S.days[today()])).toBeUndefined();
  });

  test('rejects partial numbers, exponents, signs, non-finite text and bounds', async ({ page }) => {
    await open(page);
    const amount = page.locator('[data-calc-field="amount"]');
    const per100 = page.locator('[data-calc-field="per100"]');
    await per100.fill('10');
    for (const invalid of ['12abc', '1e3', '-1', '+1', 'NaN', 'Infinity', '10 000', '10000.1', '1.2.3']) {
      await amount.fill(invalid);
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(transfer(page, 'take')).toHaveCount(0);
    }
    await amount.fill('10000');
    await expect(amount).toHaveAttribute('aria-invalid', 'false');
    for (const invalid of ['100,1', '-1', 'Infinity', '1e2', '12abc']) {
      await per100.fill(invalid);
      await expect(per100).toHaveAttribute('aria-invalid', 'true');
      await expect(transfer(page, 'take')).toHaveCount(0);
    }
    await per100.fill('100');
    await expect(transfer(page, 'take')).toBeVisible();
  });

  test('rejects grouped-looking decimals while accepting zero-prefix and ordinary decimals', async ({ page }) => {
    await open(page);
    const amount = page.locator('[data-calc-field="amount"]');
    const per100 = page.locator('[data-calc-field="per100"]');
    await per100.fill('1');
    for (const ambiguous of ['1,000', '1.000', '12,345', '12.345', '123,456', '123.456']) {
      await amount.fill(ambiguous);
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(transfer(page, 'take')).toHaveCount(0);
    }
    await amount.fill('100');
    for (const ordinary of ['12,5', '12.5', '0,125', '0.125']) {
      await per100.fill(ordinary);
      await expect(per100).toHaveAttribute('aria-invalid', 'false');
      await expect(transfer(page, 'take')).toBeVisible();
    }
  });

  test('blank day offers only takeover; recorded zero offers Add and Replace', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '100', '8');
    await expect(page.locator('#carbCalcPreview')).toContainText('Noch kein Tageswert eingetragen');
    await expect(transfer(page, 'take')).toBeVisible();
    await expect(transfer(page, 'add')).toHaveCount(0);
    await expect(transfer(page, 'replace')).toHaveCount(0);
    await page.locator('#carbCalcClose').click();
    await page.evaluate(() => { S.days[today()] = { c: 0 }; save(); renderDay(); });
    await page.locator('#carbCalcOpen').click();
    await expect(page.locator('#carbCalcPreview')).toContainText('Aktuell: 0,0 g');
    await expect(transfer(page, 'take')).toHaveCount(0);
    await expect(transfer(page, 'add')).toBeVisible();
    await expect(transfer(page, 'replace')).toBeVisible();
  });

  test('Add preview and transfer use existing daily save path and preserve plan', async ({ page }) => {
    await open(page, blankState({ days: { [today()]: { c: 18, plan: 't' } }, settings: { carbGoal: 30, carbGoalHistory: [{ date: null, value: 30 }] } }));
    await fillRow(page, 0, '100', '8');
    const card = page.locator('.carb-preview').first();
    await expect(card).toContainText('18,0 + 8,0 = 26,0 g');
    await expect(card).toContainText('Eingestelltes Tageslimit: 30,0 g');
    await expect(card).toContainText('4,0 g verbleibend');
    await transfer(page, 'add').click();
    await expect(page.locator('#carbCalc')).not.toBeVisible();
    await page.evaluate(() => carbCalcTransfer('add')); // A queued second activation has no effect after close.
    const result = await page.evaluate(() => ({ state: S.days[today()], stored: JSON.parse(localStorage.getItem(KEY)).days[today()] }));
    expect(result).toEqual({ state: { c: 26, plan: 't' }, stored: { c: 26, plan: 't' } });
    await expect(page.locator('#f_c')).toHaveValue('26');
  });

  test('Add preserves existing daily precision and ordinary JavaScript sum precision', async ({ page }) => {
    await open(page, blankState({ days: { [today()]: { c: 0.00000000001 } } }));
    await fillRow(page, 0, '10', '1');
    await expect(page.locator('.carb-preview').first()).toContainText('0,1 g');
    await transfer(page, 'add').click();
    const precise = 0.00000000001 + 0.1;
    expect(precise).toBeGreaterThan(0.1);
    expect(await page.evaluate(() => S.days[today()].c)).toBe(precise);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)).days[today()].c)).toBe(precise);

    await page.evaluate(() => { S.days[today()].c = 0.2; save(); renderDay(); });
    await page.locator('#carbCalcOpen').click();
    await fillRow(page, 0, '10', '1');
    await expect(page.locator('.carb-preview').first()).toContainText('0,3 g');
    await transfer(page, 'add').click();
    expect(await page.evaluate(() => S.days[today()].c)).toBe(0.2 + 0.1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)).days[today()].c)).toBe(0.2 + 0.1);
  });

  test('Replace preview and transfer discard previous daily carbs but preserve plan', async ({ page }) => {
    await open(page, blankState({ days: { [today()]: { c: 18, plan: 'n' } }, settings: { carbGoal: 30, carbGoalHistory: [{ date: null, value: 30 }] } }));
    await fillRow(page, 0, '100', '12');
    await expect(page.locator('.carb-preview').nth(1)).toContainText('Tageswert ersetzen: 12,0 g');
    await expect(page.locator('.carb-preview').nth(1)).toContainText('18,0 g verbleibend');
    await transfer(page, 'replace').click();
    expect(await page.evaluate(() => S.days[today()])).toEqual({ c: 12, plan: 'n' });
  });

  test('exactly at and above target use factual wording', async ({ page }) => {
    await open(page, blankState({ days: { [today()]: { c: 18 } }, settings: { carbGoal: 30, carbGoalHistory: [{ date: null, value: 30 }] } }));
    await fillRow(page, 0, '100', '12');
    await expect(page.locator('.carb-preview').first()).toContainText('0,0 g verbleibend');
    await page.locator('[data-calc-field="per100"]').fill('16');
    await expect(page.locator('.carb-preview').first()).toContainText('4,0 g über dem eingestellten Limit');
    await expect(page.locator('#carbCalc')).not.toContainText(/Ketose|ketosis|gescheitert|schlecht/i);
  });

  test('stale daily value refreshes the preview and requires a second action', async ({ page }) => {
    await open(page, blankState({ days: { [today()]: { c: 18 } } }));
    await fillRow(page, 0, '100', '12');
    await page.evaluate(() => { S.days[today()].c = 20; save(); });
    await transfer(page, 'add').click();
    await expect(page.locator('#carbCalcNotice')).toContainText('Tageswert hat sich geändert');
    expect(await page.evaluate(() => S.days[today()].c)).toBe(20);
    await expect(page.locator('.carb-preview').first()).toContainText('20,0 + 12,0 = 32,0 g');
    await transfer(page, 'add').click();
    expect(await page.evaluate(() => S.days[today()].c)).toBe(32);
  });

  test('an external localStorage change blocks transfer until reload', async ({ page }) => {
    await open(page, blankState({ days: { [today()]: { c: 18 } } }));
    await fillRow(page, 0, '100', '12');
    await page.evaluate(() => {
      const newer = JSON.parse(localStorage.getItem(KEY));
      newer.days[today()].c = 20;
      localStorage.setItem(KEY, JSON.stringify(newer));
    });
    await transfer(page, 'add').click();
    await expect(page.locator('#carbCalcNotice')).toContainText('anderen Tab geändert');
    expect(await page.evaluate(() => S.days[today()].c)).toBe(18);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)).days[today()].c)).toBe(20);
  });

  test('binds historical date and its dated target, then writes to that date only', async ({ page }) => {
    const yesterday = addDays(today(), -1);
    const state = blankState({ settings: { start: addDays(today(), -10), carbGoal: 30,
      carbGoalHistory: [{ date: null, value: 50 }, { date: today(), value: 30 }] },
      days: { [yesterday]: { c: 18 }, [today()]: { c: 6 } } });
    await gotoApp(page);await seed(page, state);
    await page.locator('[data-nav="-1"]').click();
    await page.locator('#carbCalcOpen').click();
    await expect(page.locator('#carbCalcDate')).toContainText('KH berechnen für');
    await fillRow(page, 0, '100', '12');
    await expect(page.locator('.carb-preview').first()).toContainText('Eingestelltes Tageslimit: 50,0 g');
    await transfer(page, 'add').click();
    expect(await page.evaluate(date => ({ old: S.days[date].c, current: S.days[today()].c }), yesterday)).toEqual({ old: 30, current: 6 });
  });

  test('future selected date remains the transfer destination', async ({ page }) => {
    const future = addDays(today(), 1);
    await gotoApp(page);await seed(page, blankState({ settings: { start: today(), days: 7 } }));
    await page.locator('[data-nav="1"]').click();
    await page.locator('#carbCalcOpen').click();
    await fillRow(page, 0, '100', '9');
    await transfer(page, 'take').click();
    expect(await page.evaluate(date => ({ future: S.days[date].c, current: S.days[today()] }), future)).toEqual({ future: 9, current: undefined });
  });

  test('changed selected date blocks transfer instead of writing to another day', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '100', '9');
    await page.evaluate(() => { curDate = addDays(curDate, -1); });
    await transfer(page, 'take').click();
    await expect(page.locator('#carbCalcNotice')).toContainText('ausgewählte Datum hat sich geändert');
    expect(await page.evaluate(() => S.days)).toEqual({});
  });

  test('an unavailable target omits budget arithmetic', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '100', '9');
    await page.evaluate(() => { S.settings.carbGoalHistory = []; S.settings.carbGoal = NaN; carbCalcUpdate(); });
    await expect(page.locator('#carbCalcPreview')).toContainText('Eingestelltes Tageslimit: nicht verfügbar');
    await expect(page.locator('#carbCalcPreview')).not.toContainText(/verbleibend|über dem eingestellten Limit/);
  });

  test('closing keeps draft in memory, Escape restores focus, and reload clears the draft', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '100', '8', 'Synthetic only in draft');
    await page.keyboard.press('Escape');
    await expect(page.locator('#carbCalc')).not.toBeVisible();
    await expect(page.locator('#carbCalcOpen')).toBeFocused();
    await page.locator('#carbCalcOpen').click();
    await expect(page.locator('[data-calc-field="amount"]')).toHaveValue('100');
    await expect(page.locator('[data-calc-field="name"]')).toHaveValue('Synthetic only in draft');
    await page.reload();
    await page.locator('#carbCalcOpen').click();
    await expect(page.locator('[data-calc-field="amount"]')).toHaveValue('');
    expect(await page.evaluate(() => JSON.stringify(S))).not.toContain('Synthetic only in draft');
  });

  test('transfer clears draft; calculator data stays out of state, report and print outputs', async ({ page }) => {
    await open(page);
    await fillRow(page, 0, '100', '8', 'Synthetic private meal name');
    await transfer(page, 'take').click();
    expect(await page.evaluate(() => JSON.stringify(S))).not.toContain('Synthetic private meal name');
    const outputs = await page.evaluate(() => ({ report: reportHTML(), sheet: sheetHTML(1, true) }));
    expect(outputs.report + outputs.sheet).not.toContain('Synthetic private meal name');
    await page.locator('#carbCalcOpen').click();
    await expect(page.locator('[data-calc-field="amount"]')).toHaveValue('');
    await expect(page.locator('#carbCalcTotal')).toContainText('alle Zeilen vervollständigen');
  });

  test('calculator makes no third-party requests and exports only the transferred daily value', async ({ page, context, baseURL }) => {
    const requests = [];
    context.on('request', request => requests.push(request.url()));
    await open(page);
    await fillRow(page, 0, '100', '8', 'Synthetic private food name');
    await transfer(page, 'take').click();
    await page.locator('nav button[data-tab="set"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#csv').click()]);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString();
    expect(csv).toContain('KH_g');
    expect(csv).toContain('"8"');
    expect(csv).not.toContain('Synthetic private food name');
    const appOrigin = new URL(baseURL).origin;
    expect(requests.filter(url => /^https?:/.test(url) && new URL(url).origin !== appOrigin)).toEqual([]);
  });
});
