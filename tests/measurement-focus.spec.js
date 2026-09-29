const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { gotoApp, seed, blankState, today } = require('./helpers');

const readings = { w: 82, g: 95, k: 1.2, sys1: 128, dia1: 82, sys2: 126, dia2: 78, p: 64 };

// Temporary CI diagnostics: observe geometry without scrolling, restoring
// focus, changing application state, or adding a settling delay.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const snapshots = [];
    const capture = (phase, el, trigger) => {
      const box = el.getBoundingClientRect();
      const viewport = window.visualViewport;
      const navBottom = document.querySelector('nav').getBoundingClientRect().bottom;
      const top = Math.max(viewport?.offsetTop || 0, navBottom);
      const bottom = viewport ? viewport.offsetTop + viewport.height : innerHeight;
      const active = document.activeElement;
      const predicates = {
        focus: active === el, connected: el.isConnected, height: box.height > 0,
        topBound: box.top >= top, bottomBound: box.bottom <= bottom,
      };
      const snapshot = {
        phase, trigger, time: performance.now(),
        input: { id: el.id, dataF: el.dataset.f },
        isConnected: el.isConnected,
        activeElement: { tag: active?.tagName, id: active?.id, dataF: active?.dataset?.f },
        box: { top: box.top, bottom: box.bottom, height: box.height },
        visualViewport: { offsetTop: viewport?.offsetTop ?? null, height: viewport?.height ?? null },
        innerHeight, navBottom, scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        bounds: { top, bottom }, predicates,
        visible: Object.values(predicates).every(Boolean),
      };
      snapshots.push(snapshot);
      return snapshot;
    };
    window.__measurementViewportDiagnostics = { snapshots, capture };
    document.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const active = document.activeElement;
      const block = active.closest('[data-today-measurement="bp"]');
      if (!block) return;
      const controls = [...block.querySelectorAll('summary,input[data-f]')];
      const next = controls[controls.indexOf(active) + (event.shiftKey ? -1 : 1)];
      if (next?.matches('input[data-f]')) capture('before-focus', next, 'Tab keydown');
    }, true);
    document.addEventListener('focusout', event => {
      if (event.relatedTarget?.matches('#v-day input[data-f]'))
        capture('before-focus', event.relatedTarget, 'focusout');
    }, true);
    document.addEventListener('focusin', event => {
      if (event.target.matches('#v-day input[data-f]'))
        capture('after-focus', event.target, 'focusin');
    }, true);
  });
});

// Send real pointer events: locator.fill()/focus() complete focus synchronously
// and can conceal the blur-handler race during browser-driven focus changes.
async function pointAt(page, locator, mobile) {
  await locator.scrollIntoViewIfNeeded();
  await tapVisible(page, locator, mobile);
}

async function tapVisible(page, locator, mobile) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function expectFocusedInViewport(page, input) {
  try {
    // Preserve the existing single macrotask before the strict assertions.
    await input.evaluate(el => new Promise(resolve => setTimeout(() => {
      window.__measurementViewportDiagnostics.capture('after-one-macrotask', el, 'visibility helper');
      resolve();
    }, 0)));
    await expect(input).toBeFocused();
    await expect.poll(async () => {
      const snapshot = await input.evaluate(el =>
        window.__measurementViewportDiagnostics.capture('poll', el, 'visibility helper'));
      if (!snapshot.visible) console.log('VIEWPORT_POLL_FALSE ' + JSON.stringify(snapshot));
      return snapshot.visible;
    }).toBe(true);
  } catch (error) {
    // Diagnostic failures must never replace the original assertion failure.
    try {
      await input.evaluate(el =>
        window.__measurementViewportDiagnostics.capture('final-failure', el, 'visibility helper'));
    } catch (captureError) {
      console.log('VIEWPORT_FINAL_CAPTURE_ERROR ' + captureError.message);
    }
    try {
      const diagnostics = {
        test: test.info().title, project: test.info().project.name,
        retry: test.info().retry, platform: process.platform,
        snapshots: await page.evaluate(() => window.__measurementViewportDiagnostics.snapshots),
      };
      console.log('VIEWPORT_FAILURE_DIAGNOSTICS ' + JSON.stringify(diagnostics));
      const diagnosticPath = test.info().outputPath('measurement-viewport-diagnostics.json');
      await fs.writeFile(diagnosticPath, JSON.stringify(diagnostics, null, 2));
      await test.info().attach('measurement-viewport-diagnostics', {
        path: diagnosticPath, contentType: 'application/json',
      });
    } catch (captureError) {
      console.log('VIEWPORT_HISTORY_CAPTURE_ERROR ' + captureError.message);
    }
    throw error;
  }
}

for (const [id, fields] of [['g', ['g']], ['k', ['k']], ['bp', ['sys1', 'dia1', 'sys2', 'dia2']], ['p', ['p']]]) {
  test(`completed ${id} stays visible and editable when pointer focus enters and moves within it`, async ({ page, isMobile }) => {
    await gotoApp(page);
    await seed(page, blankState({ settings: { backupWarnDismissed: today() }, days: { [today()]: readings } }));
    const storedBefore = await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'));
    const block = page.locator(`[data-today-measurement="${id}"]`);
    await pointAt(page, block.locator('summary'), isMobile);
    await expect(block.locator('details')).toHaveAttribute('open', '');
    for (const field of fields) {
      const input = block.locator(`[data-f="${field}"]`);
      await pointAt(page, input, isMobile);
      await expectFocusedInViewport(page, input);
      await expect(block.locator('details')).toHaveAttribute('open', '');
    }
    // Merely focusing must not write or mutate health data.
    expect(await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'))).toBe(storedBefore);
    const input = block.locator(`[data-f="${fields.at(-1)}"]`);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(id === 'k' ? '1,35' : '84');
    await expectFocusedInViewport(page, input);
    await pointAt(page, page.locator('#f_note'), isMobile);
    await expect(block.locator('details')).not.toHaveAttribute('open', '');
    expect(await page.evaluate(field => JSON.parse(localStorage.getItem('ketoProtokoll_v1')).days[today()][field], fields.at(-1)))
      .toBe(id === 'k' ? 1.35 : 84);
    if (id === 'bp') expect(await page.evaluate(() => ({ sys: S.days[today()].sys, dia: S.days[today()].dia })))
      .toEqual({ sys: 127, dia: 83 });
    await page.reload();
    await expect(input).toHaveValue(id === 'k' ? '1,35' : '84');
  });
}

test('entering successive empty measurements keeps the next pointer-focused input visible', async ({ page, isMobile }) => {
  await gotoApp(page);
  await seed(page, blankState({ settings: { backupWarnDismissed: today() } }));
  for (const field of ['w', 'g', 'k', 'sys1', 'dia1', 'sys2', 'dia2', 'p']) {
    const input = page.locator(`[data-f="${field}"]`);
    await pointAt(page, input, isMobile);
    await expectFocusedInViewport(page, input);
    await page.keyboard.insertText(String(readings[field]).replace('.', ','));
    await expectFocusedInViewport(page, input);
  }
  await pointAt(page, page.locator('#f_note'), isMobile);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ketoProtokoll_v1')).days[today()]))
    .toMatchObject({ ...readings, sys: 127, dia: 80 });
});

test('keyboard focus from a completed summary into BP readings leaves the editor open', async ({ page }) => {
  await gotoApp(page);
  await seed(page, blankState({ days: { [today()]: readings } }));
  const block = page.locator('[data-today-measurement="bp"]');
  await block.locator('summary').focus();
  await page.keyboard.press('Enter');
  for (const field of ['sys1', 'dia1', 'sys2', 'dia2']) {
    await page.keyboard.press('Tab');
    await expectFocusedInViewport(page, block.locator(`[data-f="${field}"]`));
  }
});


async function openMixedMeasurements(page) {
  await gotoApp(page);
  await seed(page, blankState({ settings: {
    backupWarnDismissed: today(),
    measurementSchedule: Object.fromEntries(['w', 'g', 'k', 'bp', 'p'].map(id => [id, {
      mode: ['w', 'bp'].includes(id) ? 'daily' : 'optional', weekdays: [],
    }])),
  }, days: { [today()]: readings } }));
  await page.locator('#todayExtraSummary').click();
  await page.locator('[data-today-measurement="bp"] summary').click();
}

async function expectNoBottomJump(page) {
  // These fixtures deliberately have content below the destination. Reaching
  // the end of the document is therefore neither needed nor expected.
  const gap = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
  expect(gap).toBeGreaterThan(100);
}

for (const [field, label] of [['p', 'Puls'], ['g', 'Blutzucker'], ['k', 'Ketone']]) {
  test(`completed BP -> ${label} preserves the pointer destination through compaction`, async ({ page, isMobile }) => {
    await openMixedMeasurements(page);
    await pointAt(page, page.locator('[data-f="dia2"]'), isMobile);
    const input = page.locator(`[data-f="${field}"]`);
    // Setup only: move the still-unfocused destination into the middle while
    // BP retains focus. Never correct scroll after the following pointer tap.
    await input.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const before = await input.boundingBox();
    await expectNoBottomJump(page);
    const stored = await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'));
    await tapVisible(page, input, isMobile);
    await expectFocusedInViewport(page, input);
    await expect(page.locator('[data-today-measurement="bp"] details')).not.toHaveAttribute('open', '');
    const after = await input.boundingBox();
    // Browser scroll anchoring may legitimately change scrollY. Preserve the
    // control's visual position instead of insisting on equal scroll offsets.
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await expectNoBottomJump(page);
    expect(await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'))).toBe(stored);
  });
}

test('rapid pointer transitions across BP and optional measurements preserve focus and viewport', async ({ page, isMobile }) => {
  await openMixedMeasurements(page);
  const dia2 = page.locator('[data-f="dia2"]');
  await pointAt(page, dia2, isMobile);
  // Fit the lower BP input and all three optional destinations once, before
  // the burst. Subsequent taps and assertions perform no corrective scrolling.
  await page.evaluate(() => {
    const first = document.querySelector('[data-f="dia2"]').getBoundingClientRect();
    const last = document.querySelector('[data-f="p"]').getBoundingClientRect();
    const top = document.querySelector('nav').getBoundingClientRect().bottom;
    window.scrollBy(0, (first.top + last.bottom - top - innerHeight) / 2);
  });
  const stored = await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'));
  for (const field of ['g', 'k', 'p', 'g', 'k', 'p']) {
    const input = page.locator(`[data-f="${field}"]`);
    await tapVisible(page, input, isMobile);
    await expectFocusedInViewport(page, input);
    await expectNoBottomJump(page);
  }
  await expect(page.locator('[data-today-measurement="bp"] details')).not.toHaveAttribute('open', '');
  // Return to BP, then move rapidly within it using native keyboard events.
  await tapVisible(page, page.locator('[data-today-measurement="bp"] summary'), isMobile);
  await expect(page.locator('[data-today-measurement="bp"] details')).toHaveAttribute('open', '');
  // A Safari touch tap opens a summary without necessarily focusing it.
  // Start the Tab burst from an actual input, using no focus restoration.
  await tapVisible(page, page.locator('[data-f="sys1"]'), isMobile);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expectFocusedInViewport(page, dia2);
  await expectNoBottomJump(page);
  expect(await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'))).toBe(stored);
});


test('queued compactions recheck the live destination after a burst of group focus changes', async ({ page }) => {
  await gotoApp(page);
  await seed(page, blankState({ settings: { backupWarnDismissed: today() }, days: { [today()]: readings } }));
  const stored = await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'));
  const destination = await page.evaluateHandle(() => {
    document.querySelectorAll('.today-complete').forEach(details => { details.open = true; });
    const pulse = document.querySelector('#f_p');
    window.__measurementViewportDiagnostics.capture('before-focus', pulse, 'before queued burst');
    // All transitions occur in one task, leaving multiple blur callbacks
    // pending. No stale callback may replace the final active control.
    for (const field of ['sys1', 'g', 'k', 'p', 'sys2', 'g', 'k', 'p'])
      document.querySelector(`[data-f="${field}"]`).focus();
    window.__measurementViewportDiagnostics.capture('after-focus', pulse, 'after queued burst');
    return pulse;
  });
  await expectFocusedInViewport(page, page.locator('#f_p'));
  expect(await destination.evaluate(el => el.isConnected && document.activeElement === el)).toBe(true);
  await expectNoBottomJump(page);
  await expect(page.locator('[data-today-measurement="p"] details')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => localStorage.getItem('ketoProtokoll_v1'))).toBe(stored);
  await destination.dispose();
});
