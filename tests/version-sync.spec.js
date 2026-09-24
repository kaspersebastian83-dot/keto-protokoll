const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Filesystem-only check, no browser needed: VERSION in index.html and
// sw.js's CACHE_NAME must be bumped together by hand (documented in a
// comment in both files) so a forgotten bump fails CI instead of shipping
// a stale service-worker cache.
test('VERSION in index.html matches the version embedded in sw.js CACHE_NAME', () => {
  const root = path.join(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  const versionMatch = indexHtml.match(/const VERSION=['"]([\d.]+)['"]/);
  const cacheMatch = swJs.match(/CACHE_NAME\s*=\s*['"]keto-protokoll-v([\d.]+)['"]/);

  expect(versionMatch, 'VERSION constant not found in index.html').not.toBeNull();
  expect(cacheMatch, 'CACHE_NAME not found in sw.js').not.toBeNull();
  expect(cacheMatch[1]).toBe(versionMatch[1]);
});
