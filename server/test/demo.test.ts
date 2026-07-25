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

test('sybil demo quote is explicitly one wei over the shared remaining quota', () => {
  assert.equal(amountForOverQuotaQuote(9n * 10n ** 18n), 9n * 10n ** 18n + 1n);
  assert.equal(amountForOverQuotaQuote(0n), 1n);
});

test('runtime labels distinguish local mocks, truthful execution forks, and live chains', () => {
  assert.deepEqual(classifyRuntime(31337, true), {
    mode: 'local',
    label: 'Local Anvil · mock AgentBook',
    agentBook: 'mock',
  });
  assert.deepEqual(classifyRuntime(84532, true, 'https://sepolia.base.org'), {
    mode: 'chain',
    label: 'Execution testnet · test AgentBook',
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
  assert.deepEqual(classifyRuntime(480, false, 'https://worldchain-mainnet.g.alchemy.com/public'), {
    mode: 'chain',
    label: 'World Chain · canonical AgentBook',
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

test('execution rate limits never blame the World identity chain', () => {
  const raw = new Error('HTTP request failed. Status: 429 Details: Too Many Requests');

  assert.deepEqual(describeTradeError(raw, 'base'), {
    code: 'rpc_rate_limited',
    error:
      'The execution RPC is temporarily busy. No transaction was submitted; wait a few seconds and retry.',
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

  assert.deepEqual(describeTradeError(raw, 'base'), {
    code: 'network_error',
    error:
      'The transaction is not visible to the backend RPC yet. It may already be mined; check BaseScan before retrying.',
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

test('Vite dashboard exposes judge-facing provenance and trading-terminal structure', async () => {
  const [app, marketHeader, terminal, controller, evidence, integration, lpEconomics, styles, viteConfig] = await Promise.all([
    readFile(new URL('../../web/src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/components/MarketHeader.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/components/TradingTerminal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/components/FeeControllerPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/components/EvidenceLedger.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/components/IntegrationFlow.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/components/LPEconomicsPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../web/vite.config.ts', import.meta.url), 'utf8'),
  ]);
  const source = [app, marketHeader, terminal, controller, evidence, integration, lpEconomics].join('\n');
  assert.match(
    styles,
    /:root\s*\{[^}]*color-scheme:\s*dark;[^}]*--bg:/s,
    'global page colors must be defined on :root so html/body never fall back to a white canvas',
  );
  assert.match(source, /SwapVM Router/);
  assert.match(source, /Turing Pool/);
  assert.match(source, /tETH \/ tUSD/);
  assert.match(source, /Quote ticket/);
  assert.match(source, /Live fee market/);
  assert.match(source, /Activity-priced fee controller/);
  assert.match(source, /pnpm demo:world/);
  assert.match(source, /Aqua transfers inventory/);
  assert.match(source, /On-chain receipts/);
  assert.match(source, /How each fill moves through the protocol/);
  assert.match(source, /Nuthatch indexes proof/);
  assert.match(source, /BrandLogo brand="world"/);
  assert.match(source, /BrandLogo brand="oneinch"/);
  assert.match(source, /BrandLogo brand="nuthatch"/);
  assert.match(source, /Connect MetaMask/);
  assert.match(source, /Buy tETH/);
  assert.match(source, /Sell tETH/);
  assert.match(source, /Market fee performance/);
  assert.match(source, /Estimated fee income/);
  assert.match(viteConfig, /outDir:\s*'\.\.\/public'/);
  assert.doesNotMatch(source, /price improvement for being human/i);
});

test('demo terminal never renders essential copy below a readable 10px floor', async () => {
  const styles = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
  const tinyFontDeclarations = [
    ...styles.matchAll(/font-size:\s*([0-9.]+)px/g),
    ...styles.matchAll(/font:\s*[^;{}]*?\s([0-9.]+)px(?:\/[0-9.]+)?\s/g),
  ]
    .map((match) => ({ declaration: match[0].trim(), size: Number(match[1]) }))
    .filter(({ size }) => size < 10);

  assert.deepEqual(
    tinyFontDeclarations,
    [],
    `demo copy is unreadable at presentation distance:\n${tinyFontDeclarations
      .map(({ declaration }) => declaration)
      .join('\n')}`,
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
    vercelApp.request('/demo/quotes'),
    vercelApp.request('/demo/quotes?amountIn=100000000000000000000&direction=tUSD-to-tETH'),
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
