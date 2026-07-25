import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadNuthatchActivity,
  loadNuthatchVaultAccounting,
  normalizeNuthatchUrl,
} from '../src/nuthatch.js';

const TX_HASH = `0x${'ab'.repeat(32)}`;
const ORDER_HASH = `0x${'cd'.repeat(32)}`;
const ADDRESS = `0x${'12'.repeat(20)}`;
const TOKEN_IN = `0x${'34'.repeat(20)}`;
const TOKEN_OUT = `0x${'56'.repeat(20)}`;
const REGISTRY_HASH = `0x${'ef'.repeat(32)}`;
const OTHER_REGISTRY_HASH = `0x${'01'.repeat(32)}`;
const WORLD_CHAIN_ID = 480;

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
    if (url.pathname === '/nest') {
      return jsonResponse({
        chain_id: WORLD_CHAIN_ID,
        registry_hash: REGISTRY_HASH,
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

  const activity = await loadNuthatchActivity(
    'http://127.0.0.1:8288/',
    20,
    fetcher,
    WORLD_CHAIN_ID,
  );

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
  assert.equal(requested.length, 7);
  assert.equal(
    requested.filter((url) => new URL(url).pathname === '/ready').length,
    2,
    'provenance must be checked against a readiness snapshot taken after the SQL queries',
  );
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

test('rejects index data whose persisted provenance is ahead of the connected chain', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/ready') {
      return jsonResponse({
        ready: true,
        stalled: false,
        tip: 32840655,
        last_block: 32840655,
        lag_blocks: 0,
        sealed_through: 32840600,
      });
    }
    if (url.pathname === '/nest') {
      return jsonResponse({
        chain_id: WORLD_CHAIN_ID,
        registry_hash: REGISTRY_HASH,
      });
    }
    return jsonResponse({
      count: 0,
      rows: [],
      provenance: {
        as_of: 44622541,
        sealed_through: 44622477,
        source: 'hot+sealed',
        registry_hash: REGISTRY_HASH,
      },
    });
  };

  await assert.rejects(
    () => loadNuthatchActivity(
      'http://127.0.0.1:8288',
      20,
      fetcher,
      WORLD_CHAIN_ID,
    ),
    /provenance.*ahead.*chain|chain.*provenance/i,
  );
});

test('validates SQL provenance against a final readiness snapshot', async () => {
  let readinessRequests = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/ready') {
      readinessRequests += 1;
      const block = readinessRequests === 1 ? 100 : 101;
      return jsonResponse({
        ready: true,
        stalled: false,
        tip: block,
        last_block: block,
        lag_blocks: 0,
        sealed_through: block - 1,
      });
    }
    if (url.pathname === '/nest') {
      return jsonResponse({
        chain_id: WORLD_CHAIN_ID,
        registry_hash: REGISTRY_HASH,
      });
    }
    return jsonResponse({
      count: 0,
      rows: [],
      provenance: {
        as_of: 101,
        sealed_through: 100,
        source: 'hot+sealed',
        registry_hash: REGISTRY_HASH,
      },
    });
  };

  const activity = await loadNuthatchActivity(
    'http://127.0.0.1:8288',
    20,
    fetcher,
    WORLD_CHAIN_ID,
  );

  assert.equal(readinessRequests, 2);
  assert.equal(activity.status, 'connected');
  assert.equal(activity.indexedBlock, '101');
});

test('rejects initial catch-up and inconsistent readiness metadata', async () => {
  const invalidSnapshots = [
    {
      ready: true,
      stalled: false,
      tip: 100,
      last_block: 0,
      lag_blocks: 100,
      sealed_through: 0,
    },
    {
      ready: true,
      stalled: false,
      tip: 100,
      last_block: 90,
      lag_blocks: 10,
      sealed_through: 91,
    },
    {
      ready: true,
      stalled: false,
      tip: 100,
      last_block: 90,
      lag_blocks: 9,
      sealed_through: 80,
    },
  ];

  for (const snapshot of invalidSnapshots) {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return jsonResponse(snapshot);
    };
    await assert.rejects(
      () => loadNuthatchActivity(
        'http://127.0.0.1:8288',
        20,
        fetcher,
        WORLD_CHAIN_ID,
      ),
      /not ready|sealed block|readiness lag/i,
    );
    assert.equal(requests, 1, 'invalid readiness must stop before querying index data');
  }
});

test('rejects nest chain and registry identities that do not match expectations', async () => {
  const ready = {
    ready: true,
    stalled: false,
    tip: 100,
    last_block: 100,
    lag_blocks: 0,
    sealed_through: 90,
  };
  const wrongChainFetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/ready') return jsonResponse(ready);
    return jsonResponse({
      chain_id: 84532,
      registry_hash: REGISTRY_HASH,
    });
  };
  await assert.rejects(
    () => loadNuthatchActivity(
      'http://127.0.0.1:8288',
      20,
      wrongChainFetcher,
      WORLD_CHAIN_ID,
    ),
    /chain ID.*does not match/i,
  );

  const wrongRegistryFetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/ready') return jsonResponse(ready);
    if (url.pathname === '/nest') {
      return jsonResponse({
        chain_id: WORLD_CHAIN_ID,
        registry_hash: REGISTRY_HASH,
      });
    }
    return jsonResponse({
      count: 0,
      rows: [],
      provenance: {
        as_of: 100,
        sealed_through: 90,
        source: 'hot+sealed',
        registry_hash: OTHER_REGISTRY_HASH,
      },
    });
  };
  await assert.rejects(
    () => loadNuthatchActivity(
      'http://127.0.0.1:8288',
      20,
      wrongRegistryFetcher,
      WORLD_CHAIN_ID,
    ),
    /registry hash.*does not match/i,
  );
});

test('loads LP accounting from one indexed query instead of bursting the chain RPC', async () => {
  const wallet = `0x${'78'.repeat(20)}` as const;
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (url.pathname === '/ready') {
      return jsonResponse({
        ready: true,
        stalled: false,
        tip: 32839420,
        last_block: 32839420,
        lag_blocks: 0,
        sealed_through: 32839300,
      });
    }
    if (url.pathname === '/nest') {
      return jsonResponse({
        chain_id: WORLD_CHAIN_ID,
        registry_hash: REGISTRY_HASH,
      });
    }
    return jsonResponse({
      count: 2,
      rows: [
        {
          action: 'deposit',
          amount0: '2500000000000000',
          amount1: '10000000000000000000',
          shares: '158129000000000000',
        },
        {
          action: 'withdrawal',
          amount0: '500000000000000',
          amount1: '2000000000000000000',
          shares: '31000000000000000',
        },
      ],
      provenance: {
        as_of: 32839420,
        sealed_through: 32839300,
        source: 'hot+sealed',
        registry_hash: REGISTRY_HASH,
      },
    });
  };

  const accounting = await loadNuthatchVaultAccounting(
    'http://127.0.0.1:8288',
    wallet,
    fetcher,
    WORLD_CHAIN_ID,
  );

  assert.equal(requested.length, 4, 'two readiness snapshots, nest metadata, and one SQL query');
  const sqlUrl = requested.find((url) => new URL(url).pathname === '/sql');
  assert.ok(sqlUrl);
  const sql = decodeURIComponent(new URL(sqlUrl).searchParams.get('q') ?? '');
  assert.match(sql, /active_vault__liquidity_added/);
  assert.match(sql, /active_vault__liquidity_removed/);
  assert.match(sql.toLowerCase(), new RegExp(wallet.slice(2).toLowerCase()));
  assert.deepEqual(accounting, {
    deposited: {
      token0: 2500000000000000n,
      token1: 10000000000000000000n,
      shares: 158129000000000000n,
    },
    withdrawn: {
      token0: 500000000000000n,
      token1: 2000000000000000000n,
      shares: 31000000000000000n,
    },
    depositCount: 1,
    withdrawalCount: 1,
  });
});
