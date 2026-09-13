import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all dashboard API paths reach the deployment function', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const path of [
    '/api',
    '/health',
    '/state',
    '/market/quotes',
    '/market/trade',
    '/wallet/quote',
    '/wallet/prepare',
    '/wallet/confirm',
    '/quote',
    '/autopilot/templates',
    '/autopilot/plan',
    '/autopilot/example',
    '/autopilot/example/evaluate',
    '/autopilot/example/activate',
    '/autopilot/example/pause',
    '/autopilot/example/prepare',
    '/autopilot/example/confirm',
    '/faucet',
    '/faucet/prepare',
    '/vaults',
    '/vaults/example',
    '/vaults/example/quote',
    '/vaults/create/prepare',
    '/vaults/example/trade/prepare',
    '/vaults/example/liquidity/prepare',
    '/identity/status',
    '/identity/register',
  ]) {
    assert.ok(
      config.rewrites.some(({ source, destination }) => {
        const pattern = source.replace(/\/:path\*/g, '(?:/.*)?');
        return destination === '/' && new RegExp(`^${pattern}$`).test(path);
      }),
      `${path} needs a function rewrite`,
    );
  }
});
