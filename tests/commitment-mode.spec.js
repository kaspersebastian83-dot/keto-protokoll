const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const commitment = (fields = {}) => ({ enabled: true, statement: '', reason: '', agreedRule: '', ...fields });
const state = (start, days = 90, fields = {}, entries = {}) => blankState({
  settings: { ...blankState().settings, start, days, commitment: commitment(fields) }, days: entries,
});
async function open(page, data) { await gotoApp(page); await seed(page, data); }
async function importBackup(page, data) {
  await page.locator('nav button[data-tab="set"]').click();
  await page.setInputFiles('#importFile', {
    name: 'synthetic-commitment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
}

test.describe('90-day Commitment Mode', () => {
  test('disabled mode leaves Today unchanged and has no second timeline or daily field', async ({ page }) => {
    await open(page, blankState());
    await expect(page.locator('#commitmentToday')).toHaveCount(0);
    const keys = await page.evaluate(() => ({ settings: Object.keys(S.settings), day: S.days[today()] }));
    expect(keys.settings).not.toContain('commitmentStart');
    expect(keys.settings).not.toContain('commitmentEnd');
    expect(keys.day).toBeUndefined();
  });

  test('Settings toggle enables and disables Today without erasing optional text', async ({ page }) => {
    await open(page, blankState());
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('#s_commit_reason').fill('Synthetic reason');
    await page.locator('#s_commit_reason').blur();
    await page.locator('#s_commit_enabled').check();
    await expect(page.locator('#s_commit_enabled')).toBeChecked();
    await page.locator('nav button[data-tab="day"]').click();
    await expect(page.locator('#commitmentToday')).toContainText('Synthetic reason');
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('#s_commit_enabled').uncheck();
    await page.reload();
    await expect(page.locator('#commitmentToday')).toHaveCount(0);
    expect(await page.evaluate(() => S.settings.commitment)).toEqual({
      enabled: false, statement: '', reason: 'Synthetic reason', agreedRule: '',
    });
  });

  test('progress uses the existing start, effective duration, and end in every phase', async ({ page }) => {
    await open(page, state(addDays(today(), 2), 10));
    await expect(page.locator('#commitmentToday')).toContainText('Geplanter Start:');
    await expect(page.locator('#commitmentSummary')).toHaveCount(0);
    await expect(page.locator('#commitmentBar')).toHaveAttribute('value', '0');
    await seed(page, state(today(), 90));
    await expect(page.locator('#commitmentToday')).toContainText('Tag 1 von 90 · noch 89 Tage');
    await expect(page.locator('#commitmentBar')).toHaveAttribute('value', '1');
    await seed(page, state(addDays(today(), -17), 90));
    await expect(page.locator('#commitmentToday')).toContainText('Tag 18 von 90 · noch 72 Tage');
    await seed(page, state(addDays(today(), -9), 10));
    await expect(page.locator('#commitmentToday')).toContainText('Tag 10 von 10 · letzter geplanter Tag');
    await expect(page.locator('#commitmentBar')).toHaveAttribute('value', '10');
    await seed(page, state(addDays(today(), -10), 10));
    await expect(page.locator('#commitmentToday')).toContainText('Der geplante Zeitraum ist abgeschlossen.');
    await expect(page.locator('#commitmentBar')).toHaveAttribute('value', '10');
    await page.locator('[data-commit-goto="trend"]').click();
    await expect(page.locator('#v-trend')).toBeVisible();
  });

  test('short periods use seven effective days and duration edits recalculate milestones', async ({ page }) => {
    await open(page, state(today(), 3));
    const before = await page.evaluate(() => ({ progress: commitmentProgress(S), milestones: commitmentMilestones(7) }));
    expect(before.progress.range.length).toBe(7);
    expect(before.milestones.at(-1)).toEqual({ day: 7, label: 'Abschluss' });
    expect(new Set(before.milestones.map(m => m.day)).size).toBe(before.milestones.length);
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('#s_days').fill('20');
    await page.locator('#s_days').blur();
    await page.locator('nav button[data-tab="day"]').click();
    await expect(page.locator('#commitmentToday')).toContainText('Tag 1 von 20');
    expect(await page.evaluate(() => commitmentMilestones(N()).map(m => m.day))).toEqual([5, 7, 10, 15, 20]);
  });

  test('non-finite duration cannot reach rendering or be saved from Settings', async ({ page }) => {
    await open(page, state(today(), 20));
    for (const bad of ['1e309', 'Infinity', '-1', '0', 'NaN', '']) {
      await page.locator('nav button[data-tab="set"]').click();
      await page.locator('#s_days').fill(bad);
      await page.locator('#s_days').blur();
      expect(await page.evaluate(() => S.settings.days)).toBe(20);
      await expect(page.locator('#s_days')).toHaveValue('20');
      await page.locator('nav button[data-tab="day"]').click();
      await expect(page.locator('#commitmentToday')).toContainText('Tag 1 von 20');
    }
    for (const bad of ['Infinity', '1e309', Infinity, NaN]) {
      const result = await page.evaluate(value => {
        S.settings.days = value;
        renderAll();
        return { duration: N(), end: commitmentProgress(S).range.end, text: document.body.innerText };
      }, bad);
      expect(result.duration).toBe(90);
      expect(result.end).toBe(addDays(today(), 89));
      expect(result.text).not.toMatch(/NaN-NaN-NaN|Infinity/);
      expect(result.text).toContain('Tag 1 von 90');
    }
    expect(await page.evaluate(() => effectiveDuration(20))).toBe(20);
  });

  test('the 3650-day boundary accepts the maximum and rejects larger Settings edits', async ({ page }) => {
    await open(page, state(today(), 20));
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('#s_days').fill('3650');
    await page.locator('#s_days').blur();
    expect(await page.evaluate(() => ({ stored: S.settings.days, effective: N() }))).toEqual({ stored: 3650, effective: 3650 });
    for (const bad of ['3651', '1e6', '1e12']) {
      await page.locator('#s_days').fill(bad);
      await page.locator('#s_days').blur();
      await expect(page.locator('#s_days')).toHaveValue('3650');
      expect(await page.evaluate(() => S.settings.days)).toBe(3650);
    }
    const result = await page.evaluate(() => ({ end: commitmentProgress(S).range.end,
      milestones: commitmentMilestones(N()).map(m => m.day), bar: commitmentProgress(S).shownDay,
      strip: document.querySelectorAll('#strip button').length }));
    expect(result.end).toBe(addDays(today(), 3649));
    expect(result.milestones.every(Number.isFinite)).toBe(true);
    expect(result.bar).toBe(1);
    expect(result.strip).toBe(3650);
    await expect(page.locator('#hsub')).not.toContainText(/NaN|Infinity/);
  });

  test('huge finite local durations repair to default and direct callers stay bounded', async ({ page }) => {
    await gotoApp(page);
    for (const bad of [1e12, '1000000000000', 1e6, Number.MAX_VALUE]) {
      await seed(page, state(today(), bad));
      expect(await page.evaluate(() => ({ stored: S.settings.days, effective: N(),
        end: commitmentProgress(S).range.end, strip: document.querySelectorAll('#strip button').length })))
        .toEqual({ stored: 90, effective: 90, end: addDays(today(), 89), strip: 90 });
      const direct = await page.evaluate(value => {
        S.settings.days = value;
        renderAll();
        return { effective: N(), progress: commitmentProgress(S), text: document.body.innerText };
      }, bad);
      expect(direct.effective).toBeGreaterThanOrEqual(7);
      expect(direct.effective).toBeLessThanOrEqual(3650);
      expect(direct.progress.range.end).toBe(addDays(today(), 89));
      expect(direct.progress.shownDay).toBe(1);
      expect(direct.text).not.toMatch(/NaN-NaN-NaN|Infinity/);
    }
  });

  test('extension buttons refuse to pass the maximum', async ({ page }) => {
    await open(page, state(today(), 3622));
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('[data-extend="28"]').click();
    expect(await page.evaluate(() => S.settings.days)).toBe(3650);
    await page.locator('[data-extend="84"]').click();
    expect(await page.evaluate(() => S.settings.days)).toBe(3650);
    await expect(page.locator('#status')).toContainText('Höchstens 3650 Tage');
    await page.reload();
    expect(await page.evaluate(() => S.settings.days)).toBe(3650);
  });

  test('backups above the duration maximum are rejected without replacing live data', async ({ page }) => {
    await open(page, state(today(), 20));
    const before = await page.evaluate(() => localStorage.getItem(KEY));
    const imported = state(today(), 3650, { statement: 'Synthetic imported statement' });
    expect(await page.evaluate(data => prepareBackup(data).prepared?.settings.days, imported)).toBe(3650);
    for (const days of [3651, 1e6, 1e12]) {
      await importBackup(page, { ...imported, settings: { ...imported.settings, days } });
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await page.evaluate(() => localStorage.getItem(KEY))).toBe(before);
    }
  });

  test('milestone algorithm covers week, quarters, halfway, final day, and deduplication', async ({ page }) => {
    await open(page, state(addDays(today(), -6), 90));
    expect(await page.evaluate(() => commitmentMilestones(N()).map(m => m.day))).toEqual([7, 23, 45, 68, 90]);
    await expect(page.locator('#commitmentToday')).toContainText('Meilenstein erreicht: Erste Woche (Tag 7)');
    await expect(page.locator('#commitmentToday')).toContainText('Nächster Meilenstein: Ein Viertel (Tag 23)');
    for (const [day, label] of [[23, 'Ein Viertel'], [45, 'Halbzeit'], [68, 'Drei Viertel'], [90, 'Abschluss']]) {
      await seed(page, state(addDays(today(), 1 - day), 90));
      await expect(page.locator('#commitmentToday')).toContainText(`Meilenstein erreicht: ${label} (Tag ${day})`);
    }
    expect(await page.evaluate(() => commitmentMilestones(7).map(m => m.day))).toEqual([2, 4, 5, 7]);
  });

  test('settings save bounded user text, preserve Teils, and recalculate after a start edit', async ({ page }) => {
    await open(page, state(today()));
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('#s_commit_statement').fill('  Synthetic commitment  ');
    await page.locator('#s_commit_reason').fill('  Synthetic reason  ');
    await page.locator('#s_commit_rule').fill('  Synthetic agreed rule  ');
    await page.locator('#s_commit_rule').blur();
    expect(await page.evaluate(() => S.settings.commitment)).toEqual(commitment({
      statement: 'Synthetic commitment', reason: 'Synthetic reason', agreedRule: 'Synthetic agreed rule',
    }));
    for (const [selector, limit] of [['#s_commit_statement', 240], ['#s_commit_reason', 160], ['#s_commit_rule', 240]]) {
      await expect(page.locator(selector)).toHaveAttribute('maxlength', String(limit));
      await page.locator(selector).fill('x'.repeat(limit + 20));
      await page.locator(selector).blur();
      expect((await page.locator(selector).inputValue()).length).toBe(limit);
    }
    await page.locator('#s_start').fill(addDays(today(), -4));
    await page.locator('#s_start').blur();
    await page.locator('nav button[data-tab="day"]').click();
    await expect(page.locator('#commitmentToday')).toContainText('Tag 5 von 90');
    await expect(page.locator('[data-plan="t"]')).toHaveText('Teils');
    await expect(page.locator('#commitmentToday')).not.toContainText('Größtenteils');
    await page.reload();
    expect(await page.evaluate(() => S.settings.commitment.reason.length)).toBe(160);
  });

  test('existing plan answers are reversible and rescue text appears only for Nein', async ({ page }) => {
    await open(page, state(today()));
    for (const [value, label] of [['y', 'Ja'], ['t', 'Teils'], ['n', 'Nein']]) {
      await page.locator(`[data-plan="${value}"]`).click();
      await expect(page.locator(`[data-plan="${value}"]`)).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => S.days[today()].plan)).toBe(value);
      await expect(page.locator(`[data-plan="${value}"]`)).toHaveText(label);
      await expect(page.locator('#commitmentRescue')).toHaveCount(value === 'n' ? 1 : 0);
    }
    await expect(page.locator('#commitmentRescue')).toContainText('Die nächste geplante Mahlzeit gehört wieder zum Experiment.');
    const rescue = await page.locator('#commitmentRescue').textContent();
    expect(rescue).not.toMatch(/fasten|Medikament|Strafe|Sport/i);
    await page.locator('[data-plan="n"]').click();
    expect(await page.evaluate(() => S.days[today()].plan)).toBeUndefined();
    await expect(page.locator('#commitmentRescue')).toHaveCount(0);
  });

  test('rolling 28 calendar days count every missing day without a score', async ({ page }) => {
    const start = addDays(today(), -39);
    const entries = {
      [addDays(today(), -27)]: { plan: 'y' },
      [addDays(today(), -20)]: { plan: 't' },
      [addDays(today(), -10)]: { plan: 'n' },
      [addDays(today(), -28)]: { plan: 'n' },
      [today()]: { w: 80 },
    };
    await open(page, state(start, 90, {}, entries));
    await expect(page.locator('#commitmentSummary')).toHaveText('Letzte 28 Tage: 1 Ja · 1 Teils · 1 Nein · 25 nicht eingetragen');
    expect(await page.evaluate(() => commitmentAdherence(S))).toMatchObject({ length: 28, y: 1, t: 1, n: 1, missing: 25 });
    await expect(page.locator('#commitmentToday')).not.toContainText('%');
    await seed(page, state(addDays(today(), -2), 90));
    await expect(page.locator('#commitmentSummary')).toHaveText('Letzte 3 Tage: 0 Ja · 0 Teils · 0 Nein · 3 nicht eingetragen');
  });

  test('future pre-entered plan is excluded until its calendar day arrives', async ({ page }) => {
    const start = addDays(today(), -9), future = addDays(start, 14);
    await open(page, state(start, 90, {}, { [future]: { plan: 'n' }, [today()]: { plan: 'y' } }));
    expect(await page.evaluate(() => commitmentAdherence(S))).toMatchObject({ length: 10, y: 1, n: 0, missing: 9 });
    expect(await page.evaluate(date => commitmentAdherence(S, date), future))
      .toMatchObject({ length: 15, y: 1, n: 1, missing: 13 });
  });

  test('completed summary anchors to final day and excludes later entries', async ({ page }) => {
    const start = addDays(today(), -40), end = addDays(start, 34);
    await open(page, state(start, 35, {}, { [end]: { plan: 'y' }, [today()]: { plan: 'n' } }));
    expect(await page.evaluate(() => commitmentAdherence(S))).toMatchObject({ end, length: 28, y: 1, n: 0, missing: 27 });
    await expect(page.locator('#commitmentSummary')).toContainText('1 Ja · 0 Teils · 0 Nein · 27 nicht eingetragen');
  });

  test('early new round archives settings and plan while the new round starts neutrally', async ({ page }) => {
    const start = addDays(today(), -5);
    await open(page, state(start, 90, { statement: 'Synthetic prior statement', reason: 'Synthetic reason', agreedRule: 'Synthetic rule' },
      { [start]: { plan: 't' } }));
    await page.evaluate(() => startNewRound());
    expect(await page.evaluate(() => ({ archived: S.archive[0].data.settings.commitment,
      plan: S.archive[0].data.days[S.archive[0].data.settings.start].plan,
      current: S.settings.commitment, days: S.days, start: S.settings.start }))).toEqual({
      archived: commitment({ statement: 'Synthetic prior statement', reason: 'Synthetic reason', agreedRule: 'Synthetic rule' }),
      plan: 't', current: { enabled: false, statement: '', reason: '', agreedRule: '' }, days: {}, start: today(),
    });
    await expect(page.locator('#commitmentToday')).toHaveCount(0);
    await page.reload();
    expect(await page.evaluate(() => ({ config: S.archive[0].data.settings.commitment,
      plan: S.archive[0].data.days[S.archive[0].data.settings.start].plan })))
      .toEqual({ config: commitment({ statement: 'Synthetic prior statement', reason: 'Synthetic reason', agreedRule: 'Synthetic rule' }), plan: 't' });
  });

  test('partial v6 settings and malformed local commitment repair field by field', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -3);
    for (const settings of [{}, { start }, { days: 21 }, {
      start, days: 21, name: 'Synthetic retained', measurementSchedule: blankState().settings.measurementSchedule,
      commitment: { enabled: 'bad', statement: 'keep this', reason: 123,
        agreedRule: 'r'.repeat(250) },
    }, {
      start, days: 21, commitment: commitment({ statement: 'keep valid text', agreedRule: 'keep valid rule' }),
    }]) {
      const legacy = blankState({ dataVersion: 6, settings: { ...settings }, days: { [start]: { plan: 't' } } });
      // blankState merges defaults, so replace settings with the deliberately partial object.
      legacy.settings = structuredClone(settings);
      const archived = structuredClone(legacy);
      archived.archive = [{ label: 'nested', archivedAt: today(), data: { dataVersion: 6 } }];
      legacy.archive = [{ label: 'old', archivedAt: today(), data: archived }];
      await seed(page, legacy);
      const result = await page.evaluate(() => ({
        version: S.dataVersion, start: S.settings.start, days: S.settings.days,
        name: S.settings.name, schedule: S.settings.measurementSchedule,
        config: S.settings.commitment, plan: S.days[Object.keys(S.days)[0]].plan,
        archived: S.archive[0].data, idempotent: JSON.stringify(migrate(JSON.parse(JSON.stringify(S)))) === JSON.stringify(S),
      }));
      expect(result.version).toBe(7);
      expect(result.start).toBe(settings.start || today());
      expect(result.days).toBe(settings.days || 90);
      expect(result.name).toBe(settings.name || '');
      expect(result.schedule).toEqual(blankState().settings.measurementSchedule);
      expect(result.config).toEqual({ enabled: settings.commitment?.enabled === true, statement: settings.commitment?.statement || '',
        reason: '', agreedRule: settings.commitment?.agreedRule.slice(0, 240) || '' });
      expect(result.plan).toBe('t');
      expect(result.archived.dataVersion).toBe(7);
      expect(result.archived.settings.commitment).toEqual(result.config);
      expect(result.archived.days[start].plan).toBe('t');
      expect(result.archived.archive[0].data.dataVersion).toBe(6);
      expect(result.idempotent).toBe(true);
      await expect(page.locator('#hsub')).not.toContainText('NaN');
    }
  });

  test('actual JSON backup round trip retains commitment, plan, and archived round', async ({ page }) => {
    const start = addDays(today(), -2);
    await open(page, state(start, 90, { statement: 'Synthetic statement', reason: 'Synthetic reason', agreedRule: 'Synthetic rule' },
      { [start]: { plan: 'y' } }));
    await page.evaluate(() => startNewRound());
    await page.locator('nav button[data-tab="set"]').click();
    await page.locator('#s_commit_enabled').check();
    await page.locator('#s_commit_statement').fill('Synthetic new statement');
    await page.locator('#s_commit_statement').blur();
    await page.locator('nav button[data-tab="day"]').click();
    await page.locator('[data-plan="t"]').click();
    await page.locator('nav button[data-tab="set"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exp').click()]);
    const chunks = [];
    for await (const chunk of await download.createReadStream())chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    await page.evaluate(() => { S.settings.commitment = defaultCommitment(); S.days = {}; S.archive = []; save(); });
    page.once('dialog', d => d.accept());
    await importBackup(page, exported);
    await expect.poll(() => page.evaluate(() => S.settings.commitment.statement)).toBe('Synthetic new statement');
    expect(await page.evaluate(() => ({ livePlan: S.days[today()].plan, oldPlan: S.archive[0].data.days[S.archive[0].data.settings.start].plan,
      oldConfig: S.archive[0].data.settings.commitment }))).toEqual({ livePlan: 't', oldPlan: 'y',
      oldConfig: commitment({ statement: 'Synthetic statement', reason: 'Synthetic reason', agreedRule: 'Synthetic rule' }) });
  });

  test('partial v6 backup imports with defaults while non-finite durations are rejected before migration', async ({ page }) => {
    await open(page, blankState());
    const legacy = blankState({ dataVersion: 6, days: { [today()]: { plan: 't' } } });
    legacy.settings = { start: today(), commitment: commitment({ reason: 'Synthetic retained reason' }) };
    for (const days of ['Infinity', '1e309', 'NaN', Infinity, NaN]) {
      const result = await page.evaluate(({ backup, value }) => {
        backup.settings.days = value;
        return prepareBackup(backup).error;
      }, { backup: structuredClone(legacy), value: days });
      // Playwright serializes non-finite numbers as null; string forms exercise the file path.
      expect(result).toBe('shape');
    }
    page.once('dialog', d => d.accept());
    await importBackup(page, legacy);
    await expect.poll(() => page.evaluate(() => S.dataVersion)).toBe(7);
    expect(await page.evaluate(() => ({ days: S.settings.days, reason: S.settings.commitment.reason,
      plan: S.days[today()].plan, recovery: !!readRecovery() })))
      .toEqual({ days: 90, reason: 'Synthetic retained reason', plan: 't', recovery: true });
  });

  test('v6 live and archived state migrate once without changing plan history', async ({ page }) => {
    const start = addDays(today(), -2);
    const legacy = state(start, 90, {}, { [start]: { plan: 'n' } });
    legacy.dataVersion = 6; delete legacy.settings.commitment;
    const archived = structuredClone(legacy);
    legacy.archive = [{ label: 'Synthetic old round', archivedAt: today(), data: archived }];
    await open(page, legacy);
    expect(await page.evaluate(() => ({ version: S.dataVersion, config: S.settings.commitment,
      plan: S.days[S.settings.start].plan, archivedVersion: S.archive[0].data.dataVersion,
      archivedConfig: S.archive[0].data.settings.commitment,
      idempotent: JSON.stringify(migrate(JSON.parse(JSON.stringify(S)))) === JSON.stringify(S) }))).toEqual({
      version: 7, config: { enabled: false, statement: '', reason: '', agreedRule: '' }, plan: 'n',
      archivedVersion: 7, archivedConfig: { enabled: false, statement: '', reason: '', agreedRule: '' }, idempotent: true,
    });
  });

  test('JSON import and recovery retain commitment and reject malformed or future data', async ({ page }) => {
    await open(page, state(today(), 90, { reason: 'Synthetic live reason' }, { [today()]: { plan: 'y' } }));
    const imported = state(today(), 90, { statement: 'Synthetic imported statement' }, { [today()]: { plan: 'n' } });
    page.once('dialog', d => d.accept());
    await importBackup(page, imported);
    await expect.poll(() => page.evaluate(() => S.settings.commitment.statement)).toBe('Synthetic imported statement');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(RECOVERY_KEY)).data.settings.commitment.reason)).toBe('Synthetic live reason');
    page.once('dialog', d => d.accept());
    await page.locator('#restoreRecovery').click();
    expect(await page.evaluate(() => ({ reason: S.settings.commitment.reason, plan: S.days[today()].plan })))
      .toEqual({ reason: 'Synthetic live reason', plan: 'y' });
    const before = await page.evaluate(() => localStorage.getItem(KEY));
    for (const config of [{ ...commitment(), enabled: 'yes' }, { ...commitment(), reason: 'x'.repeat(161) }, []]) {
      await importBackup(page, { ...imported, settings: { ...imported.settings, commitment: config } });
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await page.evaluate(() => localStorage.getItem(KEY))).toBe(before);
    }
    for (const days of ['Infinity', '1e309', 'NaN']) {
      await importBackup(page, { ...imported, settings: { ...imported.settings, days } });
      await expect(page.locator('#status')).toContainText('ungültiges Datenformat');
      expect(await page.evaluate(() => localStorage.getItem(KEY))).toBe(before);
    }
    await importBackup(page, { ...imported, dataVersion: 8 });
    await expect(page.locator('#status')).toContainText('neueren App-Version');
  });

  test('personal text stays out of CSV and both print outputs; report labels self-assessment', async ({ page }) => {
    const secret = 'SYNTHETIC_PRIVATE_COMMITMENT_TEXT';
    await open(page, state(today(), 90, { statement: secret, reason: secret, agreedRule: secret }, { [today()]: { plan: 't' } }));
    const outputs = await page.evaluate(() => ({ report: reportHTML(), sheet: sheetHTML(1, true) }));
    expect(outputs.report).not.toContain(secret);
    expect(outputs.sheet).not.toContain(secret);
    expect(outputs.report).toContain('Selbsteinschätzung');
    expect(outputs.sheet).toContain('Im Plan?');
    await page.locator('nav button[data-tab="set"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#csv').click()]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString();
    expect(csv).not.toContain(secret);
    expect(csv).toContain('Im_Plan');
    expect(csv).toContain('"t"');
  });

  test('commitment markup uses labels and keyboard controls', async ({ page }) => {
    await open(page, state(today(), 90, { reason: 'Langer synthetischer Grund '.repeat(5), agreedRule: 'Synthetische Vereinbarung '.repeat(7) }));
    await expect(page.locator('#commitmentBar')).toHaveAttribute('aria-label', /Experimentfortschritt/);
    await expect(page.locator('#commitmentToday')).toContainText('Tag 1 von 90');
    await page.locator('nav button[data-tab="set"]').click();
    await expect(page.locator('label[for="s_commit_enabled"]')).toBeVisible();
    for (const id of ['s_commit_statement', 's_commit_reason', 's_commit_rule'])
      await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
    await page.locator('#s_commit_enabled').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#s_commit_enabled')).not.toBeChecked();
    expect(await page.evaluate(() => S.settings.commitment.enabled)).toBe(false);
  });
});
