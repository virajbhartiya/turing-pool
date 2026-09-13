import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('selected slippage is forwarded to transaction preparation, not only displayed', async () => {
  const terminal = await readFile(new URL('../src/components/TradingTerminal.tsx', import.meta.url), 'utf8');
  assert.match(terminal, /onTrade\(amountIn, direction, slippageBps\)/);
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /executeTrade\(amount, tradeDirection, undefined, slippageBps\)/);
  assert.match(app, /body: JSON\.stringify\(\{\s*address: walletAccount,\s*amountIn: tradeAmountIn,\s*direction: tradeDirection,\s*slippageBps,/);
  assert.doesNotMatch(terminal, /% price impact/);
});
