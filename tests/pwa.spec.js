const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// Service workers require a secure context. file:// doesn't qualify, which is
// exactly why the whole suite is served over http://localhost instead (see
// tests/serve.js and playwright.config.js) — localhost is treated as secure.
test.describe('PWA / service worker', () => {
  test('registers, activates, and precaches the app shell', async ({ page }) => {
    await gotoApp(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 });

    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { active: !!r?.active, scope: r?.scope };
    });
    expect(reg.active).toBe(true);

    const cacheEntries = await page.evaluate(async () => {
      const names = await caches.keys();
      const out = {};
      for (const n of names) {
        const cache = await caches.open(n);
        out[n] = (await cache.keys()).map((req) => new URL(req.url).pathname);
      }
      return out;
    });
    const cacheNames = Object.keys(cacheEntries);
    expect(cacheNames.length).toBe(1);
    expect(cacheNames[0]).toMatch(/^keto-protokoll-v[\d.]+$/);
    for (const path of ['/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png']) {
      expect(cacheEntries[cacheNames[0]]).toContain(path);
    }
  });

  test('a page reload while offline still loads from cache', async ({ page, context }) => {
    await gotoApp(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 });

    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('h1')).toHaveText('Keto-Protokoll');
    await context.setOffline(false);
  });
});
