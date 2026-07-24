import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { amountForOverQuotaQuote, classifyRuntime, parseQuoteAmount } from '../src/demo.js';

test('sybil demo quote is explicitly one wei over the shared remaining quota', () => {
  assert.equal(amountForOverQuotaQuote(9n * 10n ** 18n), 9n * 10n ** 18n + 1n);
  assert.equal(amountForOverQuotaQuote(0n), 1n);
});

test('runtime labels distinguish local mocks, truthful Base forks, and live chains', () => {
  assert.deepEqual(classifyRuntime(31337, true), {
    mode: 'local',
    label: 'Local Anvil · mock AgentBook',
    agentBook: 'mock',
  });
  assert.deepEqual(classifyRuntime(31337, false), {
    mode: 'base-fork',
    label: 'Base fork · real AgentBook bytecode',
    agentBook: 'fork-injected',
  });
  assert.deepEqual(classifyRuntime(8453, false, 'https://mainnet.base.org'), {
    mode: 'base',
    label: 'Base mainnet',
    agentBook: 'live',
  });
});

test('quote amounts reject malformed, zero, negative, and unreasonably large input', () => {
  assert.equal(parseQuoteAmount(undefined), 10n ** 18n);
  assert.equal(parseQuoteAmount('42'), 42n);
  for (const input of ['', 'abc', '1.2', '0', '-1', (10n ** 37n).toString()]) {
    assert.throws(() => parseQuoteAmount(input), /amountIn/);
  }
});

test('static dashboard exposes judge-facing provenance and errors', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /SwapVM Router/);
  assert.match(html, /Data source/);
  assert.match(html, /connection-status/);
  assert.match(html, /bounds? (?:the )?LP|bounded risk/i);
  assert.match(html, /location\.origin/);
  assert.doesNotMatch(html, /price improvement for being human/i);
});

test('repository includes a guarded single-service deployment definition', async () => {
  const [dockerfile, blueprint] = await Promise.all([
    readFile(new URL('../../Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../../render.yaml', import.meta.url), 'utf8'),
  ]);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /start:prod/);
  assert.match(blueprint, /healthCheckPath:\s*\/health/);
  assert.match(blueprint, /DEPLOYMENTS_JSON/);
  assert.match(blueprint, /sync:\s*false/);
});
