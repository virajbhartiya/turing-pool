import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { amountForOverQuotaQuote, classifyRuntime, parseQuoteAmount } from '../src/demo.js';
import { hostedDemoQuotes, hostedState } from '../src/hosted-snapshot.js';
import vercelApp from '../src/vercel-app.js';

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
  assert.deepEqual(classifyRuntime(84532, true, 'https://sepolia.base.org'), {
    mode: 'chain',
    label: 'Base Sepolia · test AgentBook',
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
  const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.match(
    html,
    /:root\s*\{[^}]*color-scheme:\s*dark;[^}]*--surface-0:/s,
    'global page colors must be defined on :root so html/body never fall back to a white canvas',
  );
  assert.match(html, /SwapVM Router/);
  assert.match(html, /Data source/);
  assert.match(html, /connection-status/);
  assert.match(html, /bounds? (?:the )?LP|bounded risk/i);
  assert.match(html, /location\.origin/);
  assert.match(html, /One pool\. Two prices\./);
  assert.match(html, /Activity-priced fee controller/);
  assert.match(html, /pnpm demo:sepolia/);
  assert.match(html, /Aqua test deployment/);
  assert.match(html, /id="controller-proof"/);
  assert.doesNotMatch(html, /data-step="strategy"/);
  assert.doesNotMatch(html, /price improvement for being human/i);
  assert.doesNotMatch(
    html,
    /network-label'\)\.textContent = `\$\{state\.runtime\.label\} · \$\{agentBookLabel\}`/,
    'the runtime label already names the AgentBook mode and must not render it twice',
  );
});

test('repository includes a guarded single-service deployment definition', async () => {
  const [dockerfile, blueprint, vercelConfig, vercelEntry] = await Promise.all([
    readFile(new URL('../../Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../../render.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../../index.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /start:prod/);
  assert.match(blueprint, /healthCheckPath:\s*\/health/);
  assert.match(blueprint, /DEPLOYMENTS_JSON/);
  assert.match(blueprint, /sync:\s*false/);
  assert.match(vercelConfig, /"framework":\s*"hono"/);
  assert.match(vercelEntry, /export default app/);
  assert.match(vercelEntry, /vercel-app\.js/);
  assert.doesNotMatch(vercelEntry, /vercel-app\.ts/);
});

test('hosted preview snapshot stays truthful and preserves all three pricing lanes', () => {
  const quotes = hostedDemoQuotes(10n ** 18n);
  const state = hostedState();

  assert.equal(quotes.human.tier, 'tight');
  assert.equal(quotes.bot.tier, 'wide');
  assert.equal(quotes.sybil.tier, 'wide');
  assert.ok(BigInt(quotes.human.amountOut) > BigInt(quotes.bot.amountOut));
  assert.equal(state.runtime.mode, 'hosted-preview');
  assert.match(state.runtime.label, /snapshot/i);
  assert.equal(state.runtime.rpcStatus, 'not-used');
  assert.equal(state.feeController.targetFeeBps, 19);
  assert.ok(Math.abs(state.feeController.revenueDeltaBps) <= 0.5);
});

test('Vercel backend serves health, state, quotes, and an explicit non-executable quote', async () => {
  const [dashboard, health, state, quotes, anonymousQuote] = await Promise.all([
    vercelApp.request('/'),
    vercelApp.request('/health'),
    vercelApp.request('/state'),
    vercelApp.request('/demo/quotes'),
    vercelApp.request('/quote?anonymous=1'),
  ]);

  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.get('location'), '/index.html');
  assert.equal(health.status, 200);
  assert.equal(state.status, 200);
  assert.equal(quotes.status, 200);
  assert.equal(anonymousQuote.status, 200);
  assert.equal((await state.clone().json()).feeController.targetFeeBps, 19);
  assert.equal((await anonymousQuote.json()).execute.available, false);
});
