const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today, addDays } = require('./helpers');

const alert = (overrides = {}) => ({ ...blankState().settings.alerts, ...overrides });

test.describe('Dated carbohydrate goals and agreed thresholds', () => {
  test('v4 load creates detached undated baselines and migration is idempotent', async ({ page }) => {
    await gotoApp(page);
    const oldAlerts = alert({ gMax: 180, action: 'Old synthetic instruction' });
    await seed(page, blankState({
      dataVersion: 4,
      settings: { ...blankState().settings, carbGoal: 42, alerts: oldAlerts, carbGoalHistory: undefined, alertHistory: undefined },
    }));
    const result = await page.evaluate(() => {
      const first = JSON.stringify(S);
      migrate(S);
      return {
        version: S.dataVersion, goal: S.settings.carbGoal, alerts: S.settings.alerts,
        goals: S.settings.carbGoalHistory, history: S.settings.alertHistory,
        detached: S.settings.alertHistory[0].value !== S.settings.alerts,
        idempotent: JSON.stringify(S) === first,
      };
    });
    expect(result).toEqual({
      version: 6, goal: 42, alerts: oldAlerts,
      goals: [{ date: null, value: 42 }], history: [{ date: null, value: oldAlerts }],
      detached: true, idempotent: true,
    });
  });

  test('v5 load synchronizes stale live scalars without changing dated histories', async ({ page }) => {
    await gotoApp(page);
    expect(today() > '2026-09-20').toBe(true);
    const current = alert({ gMax: 160, action: 'Current synthetic action' });
    const histories = {
      carbGoalHistory: [{ date: null, value: 50 }, { date: '2026-09-20', value: 30 }],
      alertHistory: [{ date: null, value: alert({ gMax: 180 }) }, { date: '2026-09-20', value: current }],
    };
    const legacy = blankState({ dataVersion: 5, settings: {
      ...blankState().settings, carbGoal: 99, alerts: alert({ gMax: 999, action: 'Stale action' }), ...histories,
    } });
    delete legacy.settings.measurementSchedule;
    await seed(page, legacy);
    const result = await page.evaluate(() => ({
      goal: S.settings.carbGoal, alerts: S.settings.alerts,
      histories: { carbGoalHistory: S.settings.carbGoalHistory, alertHistory: S.settings.alertHistory },
      detached: S.settings.alerts !== S.settings.alertHistory.at(-1).value,
    }));
    expect(result).toEqual({ goal: 30, alerts: current, histories, detached: true });
  });

  test('date lookups are inclusive, sorted by date, pure, and range limited', async ({ page }) => {
    await gotoApp(page);
    const old = alert({ gMax: 180, sysMax: 150, action: 'Old action' });
    const middle = alert({ gMax: 170, sysMax: 150, action: 'Middle action' });
    const latest = alert({ gMax: 160, sysMax: 140, action: 'Latest action' });
    await seed(page, blankState({ settings: {
      ...blankState().settings, start: '2026-09-01', carbGoal: 30, alerts: latest,
      carbGoalHistory: [{ date: '2026-09-20', value: 30 }, { date: null, value: 50 }, { date: '2026-09-10', value: 40 }],
      alertHistory: [{ date: '2026-09-20', value: latest }, { date: null, value: old }, { date: '2026-09-10', value: middle }],
    } }));
    const result = await page.evaluate(() => {
      const before = JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory]);
      return {
        goals: ['2026-09-05', '2026-09-10', '2026-09-15', '2026-09-20', '2026-09-25'].map(carbGoalOnDate),
        alerts: ['2026-09-05', '2026-09-10', '2026-09-15', '2026-09-20', '2026-09-25'].map(d => alertsOnDate(d).gMax),
        old: alertsOnDate('2026-09-05'), middle: alertsOnDate('2026-09-15'),
        earlyRange: carbGoalsInRange('2026-09-01', '2026-09-09'),
        laterRange: alertConfigsInRange('2026-09-11', '2026-09-18'),
        unchanged: JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory]) === before,
      };
    });
    expect(result.goals).toEqual([50, 40, 40, 30, 30]);
    expect(result.alerts).toEqual([180, 170, 170, 160, 160]);
    expect(result.old).toEqual(old);
    expect(result.middle).toEqual(middle);
    expect(result.earlyRange).toEqual([{ date: null, value: 50 }]);
    expect(result.laterRange).toEqual([{ date: '2026-09-10', value: middle }]);
    expect(result.unchanged).toBe(true);
  });

  test('same-day UI edits upsert full snapshots and backdated edits leave later current values intact', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -25), back = addDays(today(), -15), later = addDays(today(), -5);
    const old = alert({ gMax: 180, sysMax: 150, action: 'Old action' });
    const current = alert({ gMax: 160, sysMax: 140, action: 'Latest action' });
    await seed(page, blankState({ settings: {
      ...blankState().settings, start, carbGoal: 30, alerts: current,
      carbGoalHistory: [{ date: null, value: 50 }, { date: back, value: 40 }, { date: later, value: 30 }],
      alertHistory: [{ date: null, value: old }, { date: later, value: current }],
    } }));
    await page.click('nav button[data-tab="set"]');
    await page.fill('#s_carb_date', back);
    await expect(page.locator('#s_carb')).toHaveValue('40');
    await page.fill('#s_carb', '45'); await page.locator('#s_carb').blur();
    await page.fill('#s_carb', '44'); await page.locator('#s_carb').blur();
    await page.fill('#al_date', back);
    await expect(page.locator('[data-al="gMax"]')).toHaveValue('180');
    await expect(page.locator('[data-al="sysMax"]')).toHaveValue('150');
    await page.fill('[data-al="gMax"]', '160'); await page.locator('[data-al="gMax"]').blur();
    await page.fill('[data-al="gMax"]', '175'); await page.locator('[data-al="gMax"]').blur();
    await page.fill('[data-al="sysMax"]', '145'); await page.locator('[data-al="sysMax"]').blur();
    await page.fill('#al_action', 'Backdated action'); await page.locator('#al_action').blur();
    const result = await page.evaluate(() => ({
      goals: S.settings.carbGoalHistory, alerts: S.settings.alertHistory,
      currentGoal: S.settings.carbGoal, currentAlerts: S.settings.alerts,
      backGoal: carbGoalOnDate(document.getElementById('s_carb_date').value),
      backAlerts: alertsOnDate(document.getElementById('al_date').value),
      dates: [document.getElementById('s_carb_date').value, document.getElementById('al_date').value],
      detached: S.settings.alerts !== S.settings.alertHistory.at(-1).value,
    }));
    expect(result.goals).toEqual([{ date: null, value: 50 }, { date: back, value: 44 }, { date: later, value: 30 }]);
    expect(result.alerts).toHaveLength(3);
    expect(result.alerts[1]).toEqual({ date: back, value: alert({ gMax: 175, sysMax: 145, action: 'Backdated action' }) });
    expect(result.alerts[2]).toEqual({ date: later, value: current });
    expect(result.currentGoal).toBe(30);
    expect(result.currentAlerts).toEqual(current);
    expect(result.backGoal).toBe(44);
    expect(result.backAlerts).toEqual(result.alerts[1].value);
    expect(result.dates).toEqual([back, back]);
    expect(result.detached).toBe(true);
    await expect(page.locator('#s_carb')).toHaveValue('44');
    await expect(page.locator('[data-al="gMax"]')).toHaveValue('175');
  });

  test('changing effective-date pickers only updates displayed values and does not save history', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -20), change = addDays(start, 10);
    const old = alert({ gMax: 180, action: 'Old action' });
    const current = alert({ gMax: 160, action: 'Current action' });
    await seed(page, blankState({ settings: {
      ...blankState().settings, start, carbGoal: 30, alerts: current,
      carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }],
      alertHistory: [{ date: null, value: old }, { date: change, value: current }],
    } }));
    await page.click('nav button[data-tab="set"]');
    const before = await page.evaluate(() => ({
      histories: JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory]),
      stored: localStorage.getItem('ketoProtokoll_v1'),
    }));
    await page.fill('#s_carb_date', start);
    await page.fill('#al_date', start);
    await expect(page.locator('#s_carb')).toHaveValue('50');
    await expect(page.locator('[data-al="gMax"]')).toHaveValue('180');
    await expect(page.locator('#al_action')).toHaveValue('Old action');
    await page.fill('#s_carb_date', change);
    await page.fill('#al_date', change);
    await expect(page.locator('#s_carb')).toHaveValue('30');
    await expect(page.locator('[data-al="gMax"]')).toHaveValue('160');
    await expect(page.locator('#al_action')).toHaveValue('Current action');
    expect(await page.evaluate(() => ({
      histories: JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory]),
      stored: localStorage.getItem('ketoProtokoll_v1'),
    }))).toEqual(before);
  });

  test('print outputs coalesce only adjacent identical complete alert configurations', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -18), same = addDays(start, 1), changed = addDays(start, 2);
    const repeat = addDays(start, 3), restored = addDays(start, 4), actionOnly = addDays(start, 5);
    const a = alert({ gMax: 180, action: 'Action A' });
    const b = alert({ gMax: 160, action: 'Action B' });
    const actionChanged = alert({ gMax: 180, action: 'Action C' });
    const history = [
      { date: null, value: a }, { date: same, value: a },
      { date: changed, value: b }, { date: repeat, value: b },
      { date: restored, value: a }, { date: actionOnly, value: actionChanged },
    ];
    await seed(page, blankState({ settings: {
      ...blankState().settings, start, days: 7, alerts: actionChanged, alertHistory: history,
    } }));
    const result = await page.evaluate(() => {
      const before = JSON.stringify(S.settings.alertHistory);
      const sheet = new DOMParser().parseFromString(sheetHTML(1, false), 'text/html');
      const report = new DOMParser().parseFromString(reportHTML(), 'text/html');
      const heading = [...report.querySelectorAll('h2')].find(e => e.textContent === 'Vereinbarte Grenzwerte');
      return {
        footer: sheet.querySelector('.alert-foot').textContent,
        rows: [...heading.nextElementSibling.querySelectorAll('tbody tr')].map(e => e.textContent),
        unchanged: JSON.stringify(S.settings.alertHistory) === before,
        raw: S.settings.alertHistory,
      };
    });
    expect(result.footer.match(/Action A/g)).toHaveLength(2);
    expect(result.footer.match(/Action B/g)).toHaveLength(1);
    expect(result.footer.match(/Action C/g)).toHaveLength(1);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.filter(row => row.includes('Action A'))).toHaveLength(2);
    expect(result.rows.filter(row => row.includes('Action B'))).toHaveLength(1);
    expect(result.rows.filter(row => row.includes('Action C'))).toHaveLength(1);
    expect(result.unchanged).toBe(true);
    expect(result.raw).toEqual(history);
  });

  test('effective-date inputs reject impossible, pre-round, and future dates without changing history', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -10);
    await seed(page, blankState({ settings: { ...blankState().settings, start } }));
    await page.click('nav button[data-tab="set"]');
    const original = await page.evaluate(() => JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory, S.settings.carbGoal, S.settings.alerts]));
    for (const date of ['2026-02-31', addDays(start, -1), addDays(today(), 1)]) {
      await page.evaluate((value) => { const el = document.getElementById('s_carb_date'); el.type = 'text'; el.value = value; }, date);
      await page.fill('#s_carb', '35'); await page.locator('#s_carb').blur();
      await page.evaluate((value) => { const el = document.getElementById('al_date'); el.type = 'text'; el.value = value; }, date);
      await page.fill('[data-al="gMax"]', '160'); await page.locator('[data-al="gMax"]').blur();
      expect(await page.evaluate(() => JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory, S.settings.carbGoal, S.settings.alerts]))).toBe(original);
    }
    await page.evaluate(() => { document.getElementById('s_carb_date').value = today(); });
    await page.fill('#s_carb', '0.4'); await page.locator('#s_carb').blur();
    expect(await page.evaluate(() => JSON.stringify([S.settings.carbGoalHistory, S.settings.alertHistory, S.settings.carbGoal, S.settings.alerts]))).toBe(original);
  });

  test('historical day hints, alert panels, live updates, and strip dots use each day\'s configuration', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -14), oldIn = addDays(start, 1), oldOut = addDays(start, 2), later = addDays(start, 10);
    const old = alert({ gMax: 180, action: 'Old action' }), next = alert({ gMax: 160, action: 'New action' });
    await seed(page, blankState({
      settings: { ...blankState().settings, start, carbGoal: 30, alerts: next,
        carbGoalHistory: [{ date: null, value: 50 }, { date: addDays(start, 7), value: 30 }],
        alertHistory: [{ date: null, value: old }, { date: addDays(start, 7), value: next }] },
      days: { [oldIn]: { g: 170 }, [oldOut]: { g: 190 }, [later]: { g: 170 } },
    }));
    await expect(page.locator(`.strip button[data-date="${oldIn}"] .alert-dot`)).toHaveCount(0);
    await expect(page.locator(`.strip button[data-date="${oldOut}"] .alert-dot`)).toHaveCount(1);
    await expect(page.locator(`.strip button[data-date="${later}"] .alert-dot`)).toHaveCount(1);
    await page.click(`.strip button[data-date="${oldOut}"]`);
    await expect(page.locator('#alertWarn')).toContainText('Old action');
    await expect(page.locator('#v-day label[for="f_c"]')).toContainText('Limit 50 g');
    await page.fill('#f_g', '175'); await page.locator('#f_g').blur();
    await expect(page.locator('#alertWarn')).toHaveCount(0);
    await expect(page.locator(`.strip button[data-date="${oldOut}"] .alert-dot`)).toHaveCount(0);
    await page.click(`.strip button[data-date="${later}"]`);
    await expect(page.locator('#alertWarn')).toContainText('New action');
    await expect(page.locator('#v-day label[for="f_c"]')).toContainText('Limit 30 g');
  });

  test('carbohydrate chart uses a dashed step whose scale includes historical goal values', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -14), change = addDays(start, 7);
    await seed(page, blankState({
      settings: { ...blankState().settings, start, days: 14, carbGoal: 30,
        carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }] },
      days: { [start]: { c: 10 }, [change]: { c: 10 } },
    }));
    const result = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(chartSet()[4], 'text/html');
      const path = doc.querySelector('path.goal');
      return { path: path.getAttribute('d'), note: doc.querySelector('figure').textContent, ticks: [...doc.querySelectorAll('svg text')].map(x => Number(x.textContent.replace(',', '.'))).filter(Number.isFinite) };
    });
    expect(result.path).toMatch(/^M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+$/);
    expect(result.path).not.toContain('L');
    expect(result.note).toContain('jeweils gültige Limit');
    expect(Math.max(...result.ticks)).toBeGreaterThan(50);
  });

  test('talking point and report carb count classify every day against its own goal', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -20), change = addDays(start, 7), days = {};
    for (let i = 0; i < 5; i++) days[addDays(start, i)] = { c: 40, k: 1 };
    for (let i = 7; i < 12; i++) days[addDays(start, i)] = { c: 40, k: 0.5 };
    await seed(page, blankState({
      settings: { ...blankState().settings, start, days: 20, carbGoal: 30,
        carbGoalHistory: [{ date: null, value: 50 }, { date: change, value: 30 }] }, days,
    }));
    const result = await page.evaluate(() => ({ points: generateTalkingPoints(), report: reportHTML() }));
    expect(result.points.some(p => p.includes('An Tagen über dem Kohlenhydrat-Limit'))).toBe(true);
    expect(result.report).toContain('an 5 von 10 Tagen über dem jeweils gültigen Limit');
    expect(result.report).toContain('Beginn des Zeitraums: 50 g/Tag');
    expect(result.report).toContain(`ab ${new Date(change + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}: 30 g/Tag`);
  });

  test('report lists dated threshold history and crossings with their actual limits', async ({ page }) => {
    await gotoApp(page);
    const start = addDays(today(), -14), change = addDays(start, 7), old = alert({ gMax: 180, action: 'Old action' }), next = alert({ gMax: 160, action: 'New action' });
    await seed(page, blankState({
      settings: { ...blankState().settings, start, days: 14, alerts: next,
        alertHistory: [{ date: null, value: old }, { date: change, value: next }] },
      days: { [addDays(start, 1)]: { g: 170 }, [addDays(start, 2)]: { g: 190 }, [addDays(start, 8)]: { g: 170 } },
    }));
    const report = await page.evaluate(() => reportHTML());
    const section = report.split('<h2>Vereinbarte Grenzwerte</h2>')[1].split('<h2>Beobachtungen')[0];
    expect(section).toContain('zu Beginn des erfassten Zeitraums');
    expect(section).toContain('Old action');
    expect(section).toContain('New action');
    expect(section).toContain('max 180 mg/dl');
    expect(section).toContain('max 160 mg/dl');
    expect((section.match(/Blutzucker:/g) || [])).toHaveLength(2);
  });
});
