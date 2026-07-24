import assert from 'node:assert/strict';
import test from 'node:test';

import { executeSwap, type QuoteResponse } from './lib.js';

const APPROVAL_HASH = `0x${'11'.repeat(32)}` as const;
const SWAP_HASH = `0x${'22'.repeat(32)}` as const;
const WALLET = '0x00000000000000000000000000000000000000aa' as const;
const TOKEN = '0x00000000000000000000000000000000000000bb' as const;
const APP = '0x00000000000000000000000000000000000000cc' as const;

const quote: QuoteResponse = {
  identity: { verified: true, humanBacked: true, humanId: '1', address: WALLET },
  tier: 'tight',
  feeBps: '8',
  amountOut: '3990000000000000000000',
  wideAmountOut: '3980000000000000000000',
  improvementBps: 22,
  quotaRemainingTokenIn: '10000000000000000000',
  execute: {
    to: APP,
    strategy: {
      maker: '0x00000000000000000000000000000000000000dd',
      token0: TOKEN,
      token1: '0x00000000000000000000000000000000000000ee',
      wideFeeBps: '30',
      tightFeeBps: '8',
      salt: `0x${'00'.repeat(31)}01`,
    },
  },
};

test('executeSwap mines approval before simulation and protects quoted output', async () => {
  const events: string[] = [];
  let amountOutMin = 0n;
  let writeCount = 0;

  const wallet = {
    account: { address: WALLET },
    async writeContract(args: any) {
      writeCount += 1;
      if (args.functionName === 'approve') {
        events.push('approval:write');
        return APPROVAL_HASH;
      }
      events.push('swap:write');
      amountOutMin = args.args[3];
      return SWAP_HASH;
    },
    async waitForTransactionReceipt({ hash }: { hash: string }) {
      events.push(hash === APPROVAL_HASH ? 'approval:mined' : 'swap:mined');
      return { status: 'success' };
    },
    async simulateContract(args: any) {
      events.push('swap:simulate');
      amountOutMin = args.args[3];
      return { result: BigInt(quote.amountOut) };
    },
  };

  await executeSwap(wallet as any, quote, TOKEN, 1_000_000_000_000_000_000n);

  assert.deepEqual(events.slice(0, 3), [
    'approval:write',
    'approval:mined',
    'swap:simulate',
  ]);
  assert.equal(writeCount, 2);
  assert.ok(amountOutMin > 0n, 'amountOutMin must never be zero');
  assert.ok(amountOutMin <= BigInt(quote.amountOut));
});
