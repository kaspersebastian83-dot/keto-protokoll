const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8934',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/serve.js',
    url: 'http://127.0.0.1:8934/index.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/mobile-webkit.spec.js' },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: '**/mobile-webkit.spec.js' },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] },
      testMatch: ['**/mobile-autosave.spec.js', '**/mobile-webkit.spec.js'] },
  ],
});
