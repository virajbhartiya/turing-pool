import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the localhost dev server proxies the market API used during initial load', async () => {
  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(
    viteConfig,
    /['"]\/market['"]\s*:\s*['"]http:\/\/localhost:4021['"]/,
    'GET /market/quotes must return JSON through localhost:4030, not the Vite HTML fallback',
  );
});
