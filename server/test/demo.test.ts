import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  amountForOverQuotaQuote,
  classifyRuntime,
  describeTradeError,
  parseQuoteAmount,
} from '../src/demo.js';
import { hostedDemoQuotes, hostedState } from '../src/hosted-snapshot.js';
import vercelApp from '../src/vercel-app.js';

test('wallet-signed execution remains enabled when server-operated trading is disabled', async () => {
  const appSource = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  const routerSource = await readFile(new URL('../src/router-demo.ts', import.meta.url), 'utf8');
  assert.match(appSource, /execution:\s*\{\s*enabled:\s*true,\s*serverOperated:\s*marketTradesEnabled\(\)/);
  const preparation = routerSource.slice(routerSource.indexOf('export async function prepareConnectedWalletTrade'), routerSource.indexOf('export async function confirmConnectedWalletTrade'));
  assert.ok(preparation.length > 0);
  assert.doesNotMatch(preparation, /marketTradesEnabled\(\)/, 'preparing wallet calldata must not require server trading keys');
});

test('sybil demo quote is explicitly one wei over the shared remaining quota', () => {
  assert.equal(amountForOverQuotaQuote(9n * 10n ** 18n), 9n * 10n ** 18n + 1n);
  assert.equal(amountForOverQuotaQuote(0n), 1n);
});

test('sybil demo quote remains executable after the shared quota reaches zero', () => {
  assert.equal(amountForOverQuotaQuote(0n, 10n ** 18n), 10n ** 18n);
  assert.equal(amountForOverQuotaQuote(5n, 3n), 6n);
});

test('runtime labels distinguish local mocks, truthful execution forks, and live chains', () => {
  assert.deepEqual(classifyRuntime(31337, true), {
    mode: 'local',
    label: 'World Chain',
    agentBook: 'mock',
  });
  assert.deepEqual(classifyRuntime(480, true, 'https://worldchain-mainnet.g.alchemy.com/public'), {
    mode: 'chain',
    label: 'Chain 480 · test AgentBook',
    agentBook: 'mock',
  });
  assert.deepEqual(classifyRuntime(31337, false), {
    mode: 'local',
    label: 'Local fork · real AgentBook bytecode',
    agentBook: 'fork-injected',
  });
  assert.deepEqual(classifyRuntime(480, false, 'https://worldchain-mainnet.g.alchemy.com/public'), {
    mode: 'world',
    label: 'World Chain',
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

test('upstream RPC rate limits become a safe, actionable trade error', () => {
  const raw = new Error(
    'HTTP request failed. Status: 429 URL: https://worldchain-mainnet.g.alchemy.com/public '
      + 'Request body: {"method":"eth_call","params":[{"data":"0x15ce4826"}]} '
      + 'Contract Call: humanGateOpcode() Details: Too Many Requests',
  );

  assert.deepEqual(describeTradeError(raw), {
    code: 'rpc_rate_limited',
    error:
      'World Chain RPC is temporarily busy. No confirmed result was received; check the explorer before retrying.',
    retryable: true,
    retryAfterSeconds: 5,
    status: 503,
  });
});

test('execution rate limits identify the World Chain RPC without claiming submission', () => {
  const raw = new Error('HTTP request failed. Status: 429 Details: Too Many Requests');

  assert.deepEqual(describeTradeError(raw), {
    code: 'rpc_rate_limited',
    error:
      'World Chain RPC is temporarily busy. No confirmed result was received; check the explorer before retrying.',
    retryable: true,
    retryAfterSeconds: 5,
    status: 503,
  });
});

test('connected-wallet receipt lag is not collapsed into the generic trade failure', () => {
  const raw = new Error(
    'TransactionReceiptNotFoundError: Transaction receipt with hash '
      + '"0x7f54c20cb641deaa7fa6248bd82d043a49c12e1ed5ce84ce82a2a314a2b4f801" could not be found.',
  );

  assert.deepEqual(describeTradeError(raw), {
    code: 'network_error',
    error:
      'The transaction is not visible to the backend RPC yet. It may already be mined; check Worldscan before retrying.',
    retryable: true,
    retryAfterSeconds: 5,
    status: 503,
  });
});

test('wallet approvals are scoped to the exact trade or deposit amount', async () => {
  const [routerDemo, vaults] = await Promise.all([
    readFile(new URL('../src/router-demo.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/vaults.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(
    routerDemo,
    /functionName:\s*'approve',\s*args:\s*\[[^\]]*,\s*maxUint256\]/s,
    'connected-wallet and demo-trade approvals must not grant unlimited router access',
  );
  assert.doesNotMatch(
    vaults,
    /functionName:\s*'approve',\s*args:\s*\[[^\]]*,\s*maxUint256\]/s,
    'vault trade and liquidity approvals must not grant unlimited access',
  );
  assert.match(
    routerDemo,
    /functionName:\s*'approve',\s*args:\s*\[deployments\.router,\s*(?:quote\.)?amountIn\]/s,
    'router approval calldata must use the exact input amount',
  );
  assert.match(
    vaults,
    /functionName:\s*'approve',\s*args:\s*\[quote\.router,\s*BigInt\(quote\.amountIn\)\]/s,
    'vault trade approval calldata must use the exact quoted input amount',
  );
});

test('anonymous live quotes use the configured bot wallet instead of a zero-address sentinel', async () => {
  const app = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /quoteRouterFor\(\s*deployments\.bot,/s);
  assert.doesNotMatch(
    app,
    /quoteRouterFor\(\s*'0x0000000000000000000000000000000000000000'/s,
    'the canonical AgentBook can resolve sentinel addresses unexpectedly',
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
  const reverse = hostedDemoQuotes(100n * 10n ** 18n, 'tUSD-to-tETH');
  const state = hostedState();

  assert.equal(quotes.human.tier, 'tight');
  assert.equal(quotes.bot.tier, 'wide');
  assert.equal(quotes.sybil.tier, 'wide');
  assert.ok(BigInt(quotes.human.amountOut) > BigInt(quotes.bot.amountOut));
  assert.equal(reverse.direction, 'tUSD-to-tETH');
  assert.equal(reverse.zeroForOne, false);
  assert.equal(reverse.tokenInSymbol, 'tUSD');
  assert.equal(reverse.tokenOutSymbol, 'tETH');
  assert.ok(BigInt(reverse.human.amountOut) > BigInt(reverse.bot.amountOut));
  assert.ok(BigInt(reverse.bot.amountOut) > 0n);
  assert.equal(state.runtime.mode, 'hosted-preview');
  assert.match(state.runtime.label, /snapshot/i);
  assert.equal(state.runtime.rpcStatus, 'not-used');
  assert.equal(state.feeController.targetFeeBps, 30);
  assert.ok(Math.abs(state.feeController.revenueDeltaBps) <= 0.5);
});

test('Vercel backend serves health, state, direction-aware quotes, and an explicit non-executable quote', async () => {
  const [dashboard, health, state, quotes, reverseQuotes, anonymousQuote] = await Promise.all([
    vercelApp.request('/'),
    vercelApp.request('/health'),
    vercelApp.request('/state'),
    vercelApp.request('/market/quotes'),
    vercelApp.request('/market/quotes?amountIn=100000000000000000000&direction=tUSD-to-tETH'),
    vercelApp.request('/quote?anonymous=1'),
  ]);

  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.get('location'), '/index.html');
  assert.equal(health.status, 200);
  assert.equal(state.status, 200);
  assert.equal(quotes.status, 200);
  assert.equal(reverseQuotes.status, 200);
  assert.equal(anonymousQuote.status, 200);
  assert.equal((await state.clone().json()).feeController.targetFeeBps, 30);
  assert.equal((await reverseQuotes.json()).direction, 'tUSD-to-tETH');
  assert.equal((await anonymousQuote.json()).execute.available, false);
});
