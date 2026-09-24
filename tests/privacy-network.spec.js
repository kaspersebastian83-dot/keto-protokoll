const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test('normal app use requests resources only from the app origin', async ({ page, context, baseURL }) => {
  const appOrigin = new URL(baseURL).origin;
  const requestedUrls = [];
  context.on('request', request => requestedUrls.push(request.url()));

  await gotoApp(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  for (const tab of ['week', 'lab', 'trend', 'print', 'set', 'lit', 'day']) {
    await page.locator(`nav button[data-tab="${tab}"]`).click();
    await expect(page.locator(`#v-${tab}`)).toBeVisible();
  }
  await page.waitForLoadState('networkidle');

  expect(requestedUrls).toContain(`${appOrigin}/index.html`);
  const thirdPartyRequests = requestedUrls.filter(url => {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && parsed.origin !== appOrigin;
  });
  expect(thirdPartyRequests, 'automatic third-party requests').toEqual([]);
});
