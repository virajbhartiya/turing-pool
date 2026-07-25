import assert from 'node:assert/strict';
import test from 'node:test';

import { loadNuthatchActivity, normalizeNuthatchUrl } from '../src/nuthatch.js';

const TX_HASH = `0x${'ab'.repeat(32)}`;
const ORDER_HASH = `0x${'cd'.repeat(32)}`;
const ADDRESS = `0x${'12'.repeat(20)}`;
const TOKEN_IN = `0x${'34'.repeat(20)}`;
const TOKEN_OUT = `0x${'56'.repeat(20)}`;
const REGISTRY_HASH = `0x${'ef'.repeat(32)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('normalizes a configured Nuthatch endpoint without changing its path', () => {
  assert.equal(normalizeNuthatchUrl('http://127.0.0.1:8288/'), 'http://127.0.0.1:8288');
  assert.equal(
    normalizeNuthatchUrl('https://indexer.example/turing/'),
    'https://indexer.example/turing',
  );
  assert.throws(() => normalizeNuthatchUrl('file:///tmp/nuthatch'), /http/i);
});

test('loads correlated SwapVM activity and preserves Nuthatch provenance', async () => {
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (url.pathname === '/ready') {
      return jsonResponse({
        ready: true,
        stalled: false,
        tip: 32811010,
        last_block: 32811009,
        lag_blocks: 1,
        sealed_through: 32810900,
      });
    }
    if (url.searchParams.get('q')?.includes('turing_activity_mix')) {
      return jsonResponse({
        count: 1,
        rows: [{
          fills: 8,
          tight_fills: 5,
          wide_fills: 3,
          tight_volume: '5000000000000000000',
          wide_volume: '3000000000000000000',
          human_share_bps: '6250',
          indexed_trade_block: 32811009,
        }],
        provenance: {
          as_of: 32811009,
          sealed_through: 32810900,
          source: 'hot+sealed',
          registry_hash: REGISTRY_HASH,
        },
      });
    }
    if (url.searchParams.get('q')?.includes('turing_fee_history')) {
      return jsonResponse({
        count: 2,
        rows: [
          {
            pool: 'vault',
            block_number: 32811009,
            tx_hash: TX_HASH,
            token: TOKEN_IN,
            tight_fee_bps: 12,
            wide_fee_bps: 48,
            human_share_bps: 5000,
          },
          {
            pool: 'vault',
            block_number: 32811008,
            tx_hash: `0x${'de'.repeat(32)}`,
            token: TOKEN_IN,
            tight_fee_bps: 10,
            wide_fee_bps: 50,
            human_share_bps: 5000,
          },
        ],
        provenance: {
          as_of: 32811009,
          sealed_through: 32810900,
          source: 'hot+sealed',
          registry_hash: REGISTRY_HASH,
        },
      });
    }
    return jsonResponse({
      count: 1,
      rows: [{
        block_number: 32811009,
        tx_hash: TX_HASH,
        order_hash: ORDER_HASH,
        taker: ADDRESS,
        human_id: '1129021701',
        tight: true,
        token_in: TOKEN_IN,
        token_out: TOKEN_OUT,
        amount_in: '100000000000000000',
        amount_out: '398000000000000000000',
        fee_bps: 5,
      }],
      provenance: {
        as_of: 32811009,
        sealed_through: 32810900,
        source: 'hot+sealed',
        registry_hash: REGISTRY_HASH,
      },
    });
  };

  const activity = await loadNuthatchActivity('http://127.0.0.1:8288/', 20, fetcher);

  assert.equal(activity.status, 'connected');
  assert.equal(activity.indexedBlock, '32811009');
  assert.equal(activity.lagBlocks, 1);
  assert.equal(activity.registryHash, REGISTRY_HASH);
  assert.equal(activity.summary.fills, 8);
  assert.equal(activity.summary.tightVolume, '5000000000000000000');
  assert.deepEqual(activity.feeHistory, [
    {
      pool: 'vault',
      blockNumber: '32811008',
      transactionHash: `0x${'de'.repeat(32)}`,
      token: TOKEN_IN,
      tightFeeBps: 10,
      wideFeeBps: 50,
      humanShareBps: 5000,
    },
    {
      pool: 'vault',
      blockNumber: '32811009',
      transactionHash: TX_HASH,
      token: TOKEN_IN,
      tightFeeBps: 12,
      wideFeeBps: 48,
      humanShareBps: 5000,
    },
  ]);
  assert.deepEqual(activity.swaps[0], {
    blockNumber: '32811009',
    transactionHash: TX_HASH,
    taker: ADDRESS,
    humanId: '1129021701',
    tight: true,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: '100000000000000000',
    amountOut: '398000000000000000000',
    feeBps: '5',
    source: 'swapvm',
  });
  assert.equal(requested.length, 5);
  assert.ok(
    requested.some((url) => decodeURIComponent(url).includes('FROM turing_all_trades')),
    'the terminal chart must include both primary-maker and permissionless-vault fills',
  );
  assert.ok(
    requested.some((url) => decodeURIComponent(url).includes('FROM turing_fee_history')),
    'the fee chart must load both verified and non-verified executable rates after every fill',
  );
});

test('rejects a stalled Nuthatch node instead of presenting stale rows as live', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/ready') {
      return jsonResponse({
        ready: false,
        stalled: true,
        tip: 100,
        last_block: 80,
        lag_blocks: 20,
      }, 503);
    }
    return jsonResponse({ count: 0, rows: [], provenance: {} });
  };

  await assert.rejects(
    () => loadNuthatchActivity('http://127.0.0.1:8288', 20, fetcher),
    /not ready|HTTP 503/i,
  );
});
