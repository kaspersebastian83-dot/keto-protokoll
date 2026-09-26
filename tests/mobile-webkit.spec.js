const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

test.describe('iPhone-sized WebKit smoke checks', () => {
  test('Today loads without a page error and daily entries survive reload', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await gotoApp(page);
    await seed(page, blankState());
    await expect(page.locator('#v-day')).toBeVisible();
    await expect(page.locator('nav button[data-tab="day"]')).toHaveAttribute('aria-selected', 'true');

    await page.locator('#f_w').tap();
    await page.locator('#f_w').fill('82');
    await page.locator('#f_note').tap();
    await page.locator('#f_note').fill('Synthetic mobile note');
    await page.locator('[data-today-measurement="w"] summary').tap();
    await page.locator('#f_w').tap();
    expect(await page.evaluate(() => S.days[today()])).toMatchObject({ w: 82, note: 'Synthetic mobile note' });

    await page.reload();
    await expect(page.locator('#f_w')).toHaveValue('82');
    await expect(page.locator('#f_note')).toHaveValue('Synthetic mobile note');
    expect(errors).toEqual([]);
  });

  test('touch navigation reaches primary views without document overflow', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    for (const [tab, section, control] of [
      ['day', '#v-day', '#f_w'],
      ['week', '#v-week', '#wsel'],
      ['lab', '#v-lab', '#lb_base'],
      ['trend', '#v-trend', '#cmpA'],
      ['set', '#v-set', '#s_name'],
    ]) {
      await page.locator(`nav button[data-tab="${tab}"]`).tap();
      await expect(page.locator(section)).toBeVisible();
      await expect(page.locator(control)).toBeVisible();
      await expect(page.locator(control)).toBeEnabled();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${tab} should not make the document scroll sideways`).toBeLessThanOrEqual(2);
    }
  });

  test('backup controls are touch reachable while the import input stays hidden', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.locator('nav button[data-tab="set"]').tap();
    await expect(page.locator('#importFile')).toBeHidden();
    await expect(page.locator('#exp')).toBeEnabled();
    await expect(page.locator('#imp')).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exp').tap()]);
    expect(download.suggestedFilename()).toMatch(/^keto-protokoll-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#imp').tap()]);
    expect(chooser.isMultiple()).toBe(false);
    await expect(page.locator('#importFile')).toBeHidden();
  });

  test('a synthetic backup imports and its previous live state restores through touch UI', async ({ page }) => {
    await gotoApp(page);
    const live = blankState({
      settings: { ...blankState().settings, name: 'Synthetic live profile' },
      days: { [today()]: { w: 80 } },
    });
    const imported = blankState({
      settings: { ...blankState().settings, name: 'Synthetic imported profile' },
      days: { [today()]: { g: 95 } },
    });
    await seed(page, live);
    await page.locator('nav button[data-tab="set"]').tap();
    page.once('dialog', dialog => dialog.accept());
    await page.setInputFiles('#importFile', {
      name: 'synthetic-mobile-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Synthetic imported profile');
    expect(await page.evaluate(() => ({
      live: S.days[today()].g,
      recovery: JSON.parse(localStorage.getItem(RECOVERY_KEY)).data.settings.name,
    }))).toEqual({ live: 95, recovery: 'Synthetic live profile' });

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#restoreRecovery').tap();
    await expect.poll(() => page.evaluate(() => S.settings.name)).toBe('Synthetic live profile');
    expect(await page.evaluate(() => ({
      weight: S.days[today()].w, recovery: localStorage.getItem(RECOVERY_KEY),
    }))).toEqual({ weight: 80, recovery: null });
  });

  test('touch Settings schedule changes persist after reload', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.locator('nav button[data-tab="set"]').tap();
    await page.locator('#ms_k').selectOption('weekdays');
    const first = await page.evaluate(() => isoWeekday(today()));
    const other = first === 7 ? 1 : first + 1;
    await page.locator(`[data-ms-id="k"][data-ms-day="${other}"]`).tap();
    const expected = [first, other].sort((a, b) => a - b);
    await page.reload();
    await page.locator('nav button[data-tab="set"]').tap();
    await expect(page.locator('#ms_k')).toHaveValue('weekdays');
    expect(await page.evaluate(() => S.settings.measurementSchedule.k.weekdays)).toEqual(expected);
    await expect(page.locator(`[data-ms-id="k"][data-ms-day="${other}"]`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('quick Today exposes non-due values through touch without overflow', async ({ page }) => {
    const state = blankState();
    state.settings.measurementSchedule.g = { mode: 'optional', weekdays: [] };
    await gotoApp(page);
    await seed(page, state);
    await expect(page.locator('#todayDue #f_w')).toBeVisible();
    await expect(page.locator('#todayDue #f_g')).toHaveCount(0);
    await page.locator('#todayExtraSummary').tap();
    await expect(page.locator('#todayExtra #f_g')).toBeVisible();
    await page.locator('#f_g').tap();
    await page.locator('#f_g').fill('94');
    await page.locator('#f_g').blur();
    await expect(page.locator('#todayExtraSummary')).toContainText('1 eingetragen');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    await page.reload();
    await expect(page.locator('#todayExtraSummary')).toContainText('1 eingetragen');
    await page.locator('#todayExtraSummary').tap();
    await expect(page.locator('#f_g')).toHaveValue('94');
  });

  test('weekly check-in card opens the existing Week form and a value survives reload', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({ settings: { start: addDays(today(), -6), days: 14 } }));
    await expect(page.locator('.weekly-checkin-card')).toContainText('Woche 1');
    await page.getByRole('button', { name: 'Wochen-Check-in öffnen' }).tap();
    await expect(page.locator('#v-week')).toBeVisible();
    await expect(page.locator('#wsel')).toHaveValue('1');
    await page.locator('#w_waist').tap();
    await page.locator('#w_waist').fill('84');
    await page.locator('#w_note').tap();
    await page.reload();
    await page.getByRole('button', { name: 'Wochen-Check-in öffnen' }).tap();
    await expect(page.locator('#wsel')).toHaveValue('1');
    await expect(page.locator('#w_waist')).toHaveValue('84');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  });

  test('Today rows stack and common controls meet phone touch targets', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    const row = page.locator('#v-day #todayDue .row').first();
    const label = await row.locator('label').boundingBox();
    const control = await row.locator('.inp').boundingBox();
    expect(control.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    expect(control.width).toBeGreaterThan(220);
    for (const selector of ['#f_w', '#dpick', '[data-scale="en"][data-v="1"]',
      '[data-plan="y"]', '[data-sym]', '[data-nav="-1"]']) {
      const box = await page.locator(`#v-day ${selector}`).first().boundingBox();
      expect(box.height, selector).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  });

  test('completed summary wraps safely and its original input stays usable', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({ days: { [today()]: { w: 820 } } }));
    const summary = page.locator('[data-today-measurement="w"] summary');
    const summaryBox = await summary.boundingBox();
    expect(summaryBox.height).toBeGreaterThanOrEqual(44);
    for (const selector of ['.today-summary-main > span:first-child', '.today-value', '.today-action', '.today-warning'])
      await expect(summary.locator(selector)).toBeVisible();
    expect(await summary.evaluate(el => [...el.querySelectorAll('.today-summary-main > span')]
      .every(child => child.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1))).toBe(true);
    await summary.tap();
    await expect(page.locator('#f_w')).toBeVisible();
    expect((await page.locator('#f_w').boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  });

  test('BP labels and pairs fit while four-reading entry still derives the average', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    const line = page.locator('#v-day .bp-line').first();
    const label = await line.locator('b').boundingBox();
    const pair = await line.locator('.inp').boundingBox();
    expect(pair.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    for (const selector of ['#f_sys1', 'input[data-f="dia1"]', '#f_sys2', 'input[data-f="dia2"]']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.height, selector).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    }
    for (const [selector, value] of [['#f_sys1', '128'], ['input[data-f="dia1"]', '82'],
      ['#f_sys2', '126'], ['input[data-f="dia2"]', '78']]) {
      await page.locator(selector).fill(value);
      await page.locator(selector).blur();
    }
    await expect(page.locator('[data-today-measurement="bp"] summary')).toContainText('127/80 mmHg');
    expect(await page.evaluate(() => ({ sys: S.days[today()].sys, dia: S.days[today()].dia })))
      .toEqual({ sys: 127, dia: 80 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  });

  test('Week rows stack and its fields and navigation stay touchable', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.locator('nav button[data-tab="week"]').tap();
    const row = page.locator('#v-week .row').first();
    const label = await row.locator('label').boundingBox();
    const control = await row.locator('.inp').boundingBox();
    expect(control.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    for (const selector of ['#w_waist', '#w_note', '#wsel', '[data-wnav="-1"]', '[data-wnav="1"]'])
      expect((await page.locator(`#v-week ${selector}`).boundingBox()).height, selector).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  });

  test('due weekly card remains neutral, full-width and opens the due week by touch', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({ settings: { start: addDays(today(), -6), days: 14 } }));
    const card = page.locator('.weekly-checkin-card');
    await expect(card).toContainText('Woche 1 · 0 von 5 Wochenwerten erfasst');
    const button = card.getByRole('button', { name: 'Wochen-Check-in öffnen' });
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThan(220);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    await button.tap();
    await expect(page.locator('#wsel')).toHaveValue('1');
  });

  test('experiment overview and data-basis rows fit before charts and comparison', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState({ days: { [today()]: { w: 80, c: 30, k: 1 } } }));
    await page.locator('nav button[data-tab="trend"]').tap();
    await expect(page.locator('#experimentOverview')).toBeVisible();
    await expect(page.locator('#dataBasis')).toBeVisible();
    const width = page.viewportSize().width;
    for (const selector of ['#experimentOverview .overview-stat', '#dataBasis .quality-row']) {
      const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }));
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.left, selector).toBeGreaterThanOrEqual(-1);
        expect(box.right, selector).toBeLessThanOrEqual(width + 1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    await expect(page.locator('#v-trend .chart').first()).toBeVisible();
    const order = await page.locator('#v-trend > *').evaluateAll(nodes => nodes.map(node => node.id||node.querySelector('h2')?.textContent));
    expect(order.slice(0,4)).toEqual(['experimentOverview','experimentSummary','historicalComparison','dataBasis']);
    await expect(page.locator('#cmpA')).toBeVisible();
    await expect(page.locator('#cmpB')).toBeVisible();
    await page.locator('#cmpA').selectOption('w');
    await expect(page.locator('#cmpChart')).toContainText('Gewicht');
  });

  test('experiment summary rows wrap on phone width and leave charts reachable', async ({ page }) => {
    const start = addDays(today(), -20);
    const days = Object.fromEntries([0, 7, 14].map((offset, i) =>
      [addDays(start, offset), { sys: 130 - i * 2, dia: 82 - i, w: 82 - i }]));
    await gotoApp(page);
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 28 }, days }));
    await page.locator('nav button[data-tab="trend"]').tap();
    const summary = page.locator('#experimentSummary');
    await expect(summary).toBeVisible();
    await expect(summary.locator('[data-summary="sys"]')).toBeVisible();
    const width = page.viewportSize().width;
    const boxes = await summary.locator('.summary-row').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(width + 1);
    }
    const heading = summary.locator('[data-summary="sys"] h3');
    await heading.evaluate(el => { el.style.maxWidth = '130px'; });
    expect(await heading.evaluate(el => el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    const order = await page.locator('#v-trend > *').evaluateAll(nodes => nodes.map(node => node.id || node.querySelector('h2')?.textContent));
    expect(order.slice(0,4)).toEqual(['experimentOverview','experimentSummary','historicalComparison','dataBasis']);
    await expect(page.locator('#v-trend .chart').first()).toBeVisible();
    await expect(page.locator('#cmpA')).toBeVisible();
    await expect(page.locator('#cmpB')).toBeVisible();
    await page.locator('#cmpA').selectOption('w');
    await expect(page.locator('#cmpChart')).toContainText('Gewicht');
  });

  test('historical comparison stacks period sides and keeps Verlauf reachable on phone width', async ({ page }) => {
    const start = addDays(today(), -30);
    const days = Object.fromEntries([0, 7, 14].map((offset, i) =>
      [addDays(start, offset), { sys: 130 - i * 2, w: 82 - i }]));
    const archive = blankState({ settings: { ...blankState().settings, start, days: 28 }, days });
    await gotoApp(page);
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 35 }, days,
      archive: [{ label: `Archiv-${'A'.repeat(160)}`, archivedAt: addDays(start, 20), data: archive }] }));
    await page.locator('nav button[data-tab="trend"]').tap();
    const panel = page.locator('#historicalComparison');
    await expect(panel).toBeVisible();
    await expect(panel.locator('#historicalArchive')).toBeVisible();
    await expect(panel.locator('[data-compare="sys"]')).toBeVisible();
    const width = page.viewportSize().width;
    for (const selector of ['#historicalArchive', '#historicalComparisonContent .sub', '.period-compare-row', '.period-side']) {
      const boxes = await panel.locator(selector).evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }));
      expect(boxes.length, selector).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.left, selector).toBeGreaterThanOrEqual(-1);
        expect(box.right, selector).toBeLessThanOrEqual(width + 1);
      }
    }
    const context = panel.locator('#historicalComparisonContent .sub').first();
    expect(await context.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
    const sides = await panel.locator('[data-compare="sys"] .period-side').evaluateAll(nodes =>
      nodes.map(node => ({ y: node.getBoundingClientRect().y, bottom: node.getBoundingClientRect().bottom })));
    expect(sides[1].y).toBeGreaterThanOrEqual(sides[0].bottom - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    const order = await page.locator('#v-trend > *').evaluateAll(nodes => nodes.map(node => node.id || node.querySelector('h2')?.textContent));
    expect(order.slice(0,4)).toEqual(['experimentOverview','experimentSummary','historicalComparison','dataBasis']);
    await expect(page.locator('#v-trend .chart').first()).toBeVisible();
    await expect(page.locator('#cmpA')).toBeVisible();
    await expect(page.locator('#cmpB')).toBeVisible();
  });

  test('fixed charts keep readable SVG width inside keyboard and touch scroll regions', async ({ page }) => {
    const start = addDays(today(), -20), change = addDays(start, 7);
    const meds = [{ id: 'syntheticMed', name: `Synthetic ${'long-name-'.repeat(12)}`,
      dose: '10 mg', category: 'Medikament', startedAt: start, stoppedAt: null }];
    const days = { [start]: { w: 80, g: 90, k: 1, sys: 120, dia: 80, c: 35 },
      [change]: { w: 79, g: 92, k: 1.2, sys: 122, dia: 82, c: 40 } };
    await gotoApp(page);
    await seed(page, blankState({ settings: { ...blankState().settings, start, days: 28, meds }, days,
      weeks: { 1: { rhr: 60, waist: 90 }, 2: { rhr: 61, waist: 89 } },
      doseChanges: [{ date: change, medId: 'syntheticMed', oldDose: '5 mg', newDose: '10 mg' }] }));
    await page.locator('nav button[data-tab="trend"]').tap();
    const figures = page.locator('#v-trend .fixed-charts figure');
    await expect(figures).toHaveCount(7);
    await expect(page.locator('.fixed-charts > h2')).toBeVisible();
    await expect(figures.first().locator('.chart-meta')).toBeVisible();
    await expect(figures.first().locator('.chart-scroll-hint')).toBeVisible();
    const widths = await page.locator('.fixed-charts .chart-viewport').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      const svg = node.querySelector('svg').getBoundingClientRect();
      const caption = node.closest('figure').querySelector('figcaption').getBoundingClientRect();
      return { left: box.left, right: box.right, client: node.clientWidth, scroll: node.scrollWidth,
        svg: svg.width, captionLeft: caption.left, captionRight: caption.right,
        tabIndex: node.tabIndex, role: node.getAttribute('role'), label: node.getAttribute('aria-label') };
    }));
    expect(widths).toHaveLength(7);
    const viewportWidth = page.viewportSize().width;
    for (const item of widths) {
      expect(item.left).toBeGreaterThanOrEqual(-1);
      expect(item.right).toBeLessThanOrEqual(viewportWidth + 1);
      expect(item.captionLeft).toBeGreaterThanOrEqual(-1);
      expect(item.captionRight).toBeLessThanOrEqual(viewportWidth + 1);
      expect(item.svg).toBeGreaterThanOrEqual(599);
      expect(item.scroll).toBeGreaterThan(item.client);
      expect(item.tabIndex).toBe(0);
      expect(item.role).toBe('region');
      expect(item.label).toContain('seitlich verschiebbares Diagramm');
    }
    const first = page.locator('.fixed-charts .chart-viewport').first();
    await first.evaluate(node => { node.scrollLeft = 120; });
    expect(await first.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await first.focus();
    const beforeKey = await first.evaluate(node => node.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => first.evaluate(node => node.scrollLeft)).toBeGreaterThan(beforeKey);
    await expect(figures.nth(3)).toContainText('Diastolisch: 2');
    await expect(figures.nth(3)).toContainText('diastolisch (gestrichelt)');
    for (const panel of ['#experimentOverview', '#experimentSummary', '#historicalComparison', '#dataBasis'])
      await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator('#cmpA')).toBeVisible();
    await expect(page.locator('#cmpB')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(2);
  });
});
