const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState } = require('./helpers');

test.describe('Nav bar fixed height (Part A)', () => {
  test('nav bounding-box height is identical whether or not the tabs overflow horizontally', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());

    await page.setViewportSize({ width: 1200, height: 800 });
    const wideHeight = await page.locator('nav').evaluate((el) => el.getBoundingClientRect().height);

    await page.setViewportSize({ width: 320, height: 800 }); // narrow enough that all 7 tabs overflow
    const overflows = await page.locator('nav').evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBe(true); // confirms this actually exercises the overflow case, not a no-op

    const narrowHeight = await page.locator('nav').evaluate((el) => el.getBoundingClientRect().height);
    expect(narrowHeight).toBe(wideHeight);
  });

  test('the tab row is still horizontally scrollable at the narrow width', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.setViewportSize({ width: 320, height: 800 });

    await page.locator('nav').evaluate((el) => { el.scrollLeft = 60; });
    const scrollLeft = await page.locator('nav').evaluate((el) => el.scrollLeft);
    expect(scrollLeft).toBeGreaterThan(0);

    // The last tab (Literatur) is reachable by scrolling.
    await page.locator('nav').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect(page.locator('nav button[data-tab="lit"]')).toBeInViewport();
  });
});

test.describe('iOS standalone print notice (Part B)', () => {
  test('appears when display-mode: standalone is simulated', async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia?.bind(window);
      window.matchMedia = (query) => {
        if (query === '(display-mode: standalone)') {
          return { matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
        }
        return original ? original(query) : { matches: false, media: query, addListener() {}, removeListener() {} };
      };
    });
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="print"]');

    await expect(page.locator('#standaloneNote')).toBeVisible();
    await expect(page.locator('#standaloneNote')).toContainText('Safari öffnen');
    // Advisory only — the print buttons must still be present and enabled.
    await expect(page.locator('#doSheet')).toBeEnabled();
    await expect(page.locator('#doReport')).toBeEnabled();
  });

  test('is absent in a normal browser tab', async ({ page }) => {
    await gotoApp(page);
    await seed(page, blankState());
    await page.click('nav button[data-tab="print"]');

    await expect(page.locator('#standaloneNote')).toHaveCount(0);
  });
});
