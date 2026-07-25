import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { parseDemoTradeDirection, parseQuoteAmount } from './demo.js';
import { hostedDemoQuotes, hostedState } from './hosted-snapshot.js';

const app = new Hono();
app.use('*', cors());

app.get('/', (c) => c.redirect('/index.html'));

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'turing-pool',
    mode: 'hosted-preview-snapshot',
  }),
);

app.get('/api', (c) =>
  c.json({
    name: 'Turing Pool hosted preview API',
    mode: 'hosted-preview-snapshot',
    note: 'Use pnpm demo:fork for cryptographic AgentKit verification and executable swaps',
  }),
);

app.get('/state', (c) => c.json(hostedState()));

app.get('/demo/quotes', (c) => {
  try {
    const amountIn = parseQuoteAmount(c.req.query('amountIn'));
    const direction = parseDemoTradeDirection(c.req.query('direction'));
    return c.json(hostedDemoQuotes(amountIn, direction));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'invalid amountIn' }, 400);
  }
});

app.get('/quote', (c) => {
  let amountIn: bigint;
  let zeroForOne: boolean;
  try {
    amountIn = parseQuoteAmount(c.req.query('amountIn'));
    zeroForOne = (c.req.query('zeroForOne') ?? 'true') === 'true';
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'invalid amountIn' }, 400);
  }

  if (c.req.query('anonymous') !== '1') {
    return c.json(
      {
        error: 'agentkit_proof_requires_live_chain',
        mode: 'hosted-preview-snapshot',
        note: 'Run pnpm demo:fork for the full 402 → SIWE → on-chain AgentBook flow',
      },
      402,
    );
  }

  const direction = zeroForOne ? 'tETH-to-tUSD' : 'tUSD-to-tETH';
  const preview = hostedDemoQuotes(amountIn, direction);
  return c.json({
    pool: 'tETH/tUSD',
    mode: preview.mode,
    amountIn: amountIn.toString(),
    direction,
    zeroForOne,
    tokenIn: preview.tokenIn,
    tokenOut: preview.tokenOut,
    tokenInSymbol: preview.tokenInSymbol,
    tokenOutSymbol: preview.tokenOutSymbol,
    identity: { verified: false, simulated: true },
    tier: preview.bot.tier,
    feeBps: preview.bot.feeBps,
    amountOut: preview.bot.amountOut,
    wideAmountOut: preview.bot.amountOut,
    improvementBps: 0,
    quotaRemainingTokenIn: '0',
    feeSchedule: preview.feeSchedule,
    execute: {
      available: false,
      note: 'Snapshot quotes are not executable; use pnpm demo:fork for live execution',
    },
  });
});

export default app;
