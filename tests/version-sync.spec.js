const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Filesystem-only check: all release version fields must be bumped together
// so a forgotten cache bump fails CI instead of shipping stale app files.
test('release version metadata stays synchronized across app and package files', () => {
  const root = path.join(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

  const versionMatch = indexHtml.match(/const VERSION=['"]([\d.]+)['"]/);
  const cacheMatch = swJs.match(/CACHE_NAME\s*=\s*['"]keto-protokoll-v([\d.]+)['"]/);

  expect(versionMatch, 'VERSION constant not found in index.html').not.toBeNull();
  expect(cacheMatch, 'CACHE_NAME not found in sw.js').not.toBeNull();
  const version = versionMatch[1];
  expect(packageJson.version).toBe(version);
  expect(packageLock.version).toBe(version);
  expect(packageLock.packages[''].version).toBe(version);
  expect(cacheMatch[1]).toBe(version);
});
