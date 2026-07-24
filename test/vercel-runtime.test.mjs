import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const functionEntry = resolve('.vercel/output/functions/index.func/index.js');
const dashboardEntry = resolve('.vercel/output/static/index.html');

test('the built Vercel output initializes and serves every hosted route', async () => {
  await Promise.all([access(functionEntry), access(dashboardEntry)]);

  const builtModule = await import(
    `${pathToFileURL(functionEntry).href}?test=${Date.now()}`
  );
  const handler = builtModule.default;

  assert.equal(typeof handler?.fetch, 'function');
  const request = (path) =>
    handler.fetch(new Request(`https://turing-pool.test${path}`));
  const [dashboard, health, state, quotes, anonymous, challenge, invalid] =
    await Promise.all([
      request('/'),
      request('/health'),
      request('/state'),
      request('/demo/quotes'),
      request('/quote?anonymous=1'),
      request('/quote'),
      request('/quote?anonymous=1&amountIn=invalid'),
    ]);

  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.get('location'), '/index.html');
  assert.equal(health.status, 200);
  assert.equal(state.status, 200);
  assert.equal(quotes.status, 200);
  assert.equal(anonymous.status, 200);
  assert.equal(challenge.status, 402);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'turing-pool',
    mode: 'hosted-preview-snapshot',
  });
  assert.match(await readFile(dashboardEntry, 'utf8'), /Turing Pool/);
});
