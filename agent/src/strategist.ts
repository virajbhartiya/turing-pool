/// The Strategist: an autonomous agent that closes the pricing loop.
/// It reads per-tier flow data (subgraph if SUBGRAPH_URL is set, otherwise the
/// API's chain-indexed /state), measures how toxic each tier's flow actually is,
/// decides new spread parameters (Claude reasoning when ANTHROPIC_API_KEY is set,
/// deterministic heuristic otherwise), then DOCKS the running Aqua strategy and
/// SHIPS a re-parameterized one. Aqua strategies are immutable - repricing IS
/// dock+ship, which is exactly what this demonstrates.
import {
  calculateRevenueNeutralFees,
  DEFAULT_REVENUE_POLICY,
  type RevenueNeutralFeeDecision,
} from '@turing-pool/economics';

import {
  API_URL,
  CHAIN_ID,
  KEYS,
  RPC_URL,
  fmt,
  loadDeployments,
  makeWallet,
} from './lib.js';
import {
  requireStrategistGraphData,
  STRATEGIST_QUERY,
  type StrategistSwap,
} from './strategist-query.js';

const d = loadDeployments();
const wallet = makeWallet(KEYS.maker); // strategist acts for the maker

type SwapRow = StrategistSwap;

interface TierStats {
  count: number;
  normalizedVolumeToken0: bigint;
  // Markout proxy: how much better/worse than the CURRENT mid each fill was, in bps.
  // Positive = LP kept edge (benign flow). Negative = flow beat the pool (toxic).
  avgLpEdgeBps: number;
}

interface StrategistInput {
  swaps: SwapRow[];
  mid: number;
  pool: any;
  dataSource: string;
}

async function fetchSwaps(): Promise<StrategistInput> {
  const subgraphUrl = process.env.SUBGRAPH_URL;
  if (subgraphUrl) {
    const res = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: STRATEGIST_QUERY,
        variables: { app: d.app.toLowerCase() },
      }),
    });
    if (!res.ok) {
      throw new Error(`The Graph request failed with HTTP ${res.status}: ${await res.text()}`);
    }
    const data = requireStrategistGraphData(await res.json());
    const s = data.strategies[0];
    return {
      swaps: data.swaps,
      mid: Number(s.balance1) / Number(s.balance0),
      pool: s,
      dataSource: `The Graph (${subgraphUrl})`,
    };
  }

  const usesLocalRpc = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/.test(RPC_URL);
  const explicitChainFallback = process.env.ALLOW_CHAIN_EVENT_FALLBACK === '1';
  if ((CHAIN_ID !== 31337 || !usesLocalRpc) && !explicitChainFallback) {
    throw new Error(
      'SUBGRAPH_URL is required outside local development; set ALLOW_CHAIN_EVENT_FALLBACK=1 only for a truthfully labeled public-testnet rehearsal',
    );
  }
  const state = await (await fetch(`${API_URL}/state`)).json();
  return {
    swaps: state.swaps,
    mid: Number(state.pool.balance1) / Number(state.pool.balance0),
    pool: state.pool,
    dataSource: explicitChainFallback
      ? 'EXPLICIT TESTNET FALLBACK: API /state decoded chain events (The Graph not connected)'
      : 'LOCAL FALLBACK: API /state chain logs (not for judged runs)',
  };
}

function tierStats(swaps: SwapRow[], tight: boolean, mid: number, token0: string): TierStats {
  const rows = swaps.filter((s) => s.tight === tight);
  let normalizedVolumeToken0 = 0n;
  let edgeSum = 0;
  for (const s of rows) {
    const zeroForOne = s.tokenIn.toLowerCase() === token0.toLowerCase();
    normalizedVolumeToken0 += zeroForOne ? BigInt(s.amountIn) : BigInt(s.amountOut);
    const px = zeroForOne
      ? Number(s.amountOut) / Number(s.amountIn)
      : Number(s.amountIn) / Number(s.amountOut);
    // LP edge: for zeroForOne fills the LP sold token1 at px; if px < current mid
    // the LP sold below where the market went -> negative edge (toxic flow).
    const edgeBps = zeroForOne ? ((mid - px) / mid) * 10_000 : ((px - mid) / mid) * 10_000;
    edgeSum += edgeBps;
  }
  return {
    count: rows.length,
    normalizedVolumeToken0,
    avgLpEdgeBps: rows.length ? edgeSum / rows.length : 0,
  };
}

interface Decision {
  tightFeeBps: number;
  wideFeeBps: number;
  rationale: string;
  policy: RevenueNeutralFeeDecision;
}

interface PricingSignal {
  desiredTightFeeBps: number;
  rationale: string;
}

function revenueNeutralDecision(
  tightS: TierStats,
  wideS: TierStats,
  cur: { tight: number; wide: number },
  desiredTightFeeBps: number,
  signalRationale: string,
): Decision {
  const policy = calculateRevenueNeutralFees({
    ...DEFAULT_REVENUE_POLICY,
    tightVolume: tightS.normalizedVolumeToken0,
    wideVolume: wideS.normalizedVolumeToken0,
    currentTightFeeBps: cur.tight,
    currentWideFeeBps: cur.wide,
    desiredTightFeeBps,
  });
  const exactness =
    policy.revenueDeltaBps === 0
      ? `preserves the ${policy.targetFeeBps} bps blended LP target exactly`
      : `lands at ${policy.projectedWeightedFeeBps.toFixed(3)} bps after integer-bps rounding (${policy.revenueDeltaBps >= 0 ? '+' : ''}${policy.revenueDeltaBps.toFixed(3)} bps)`;
  return {
    tightFeeBps: policy.tightFeeBps,
    wideFeeBps: policy.wideFeeBps,
    rationale:
      `${signalRationale}; activity mix is ${(policy.humanShareBps / 100).toFixed(1)}% human-backed; ` +
      `controller sets ${policy.tightFeeBps}/${policy.wideFeeBps} bps and ${exactness}`,
    policy,
  };
}

function heuristicDecision(
  tightS: TierStats,
  wideS: TierStats,
  cur: { tight: number; wide: number },
): Decision {
  const reasons: string[] = [];
  let desiredTightFeeBps = cur.tight;

  if (tightS.count > 0 && tightS.avgLpEdgeBps > -cur.tight / 2) {
    desiredTightFeeBps = Math.min(cur.tight, DEFAULT_REVENUE_POLICY.desiredTightFeeBps);
    reasons.push(
      `human-backed flow is benign (avg LP edge ${tightS.avgLpEdgeBps.toFixed(2)} bps over ${tightS.count} fills), so target the ${desiredTightFeeBps} bps retail floor`,
    );
  } else if (tightS.count > 0) {
    reasons.push('human-backed flow does not support a deeper discount, so hold the current retail fee');
  } else {
    reasons.push('no tight-tier fills yet, so hold until both activity lanes are observed');
  }

  return revenueNeutralDecision(
    tightS,
    wideS,
    cur,
    desiredTightFeeBps,
    reasons.join('; '),
  );
}

async function claudePricingSignal(
  tightS: TierStats,
  wideS: TierStats,
  cur: { tight: number; wide: number },
): Promise<PricingSignal | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system:
          'You are the risk signal for Turing Pool. Positive avgLpEdgeBps means the LP kept edge; negative means flow beat the pool. Recommend only a desired human-backed fee. A deterministic revenue controller will solve the bot fee and preserve the LP target. Reply ONLY with JSON: {"desiredTightFeeBps": int, "rationale": string}. Keep 5 <= desiredTightFeeBps <= the current tight fee.',
        messages: [
          {
            role: 'user',
            content: `Current fees: tight=${cur.tight}bps wide=${cur.wide}bps.\nTight tier: ${tightS.count} fills, avgLpEdgeBps=${tightS.avgLpEdgeBps.toFixed(2)}.\nWide tier: ${wideS.count} fills, avgLpEdgeBps=${wideS.avgLpEdgeBps.toFixed(2)}.\nDecide new fees.`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const text = body.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (
      Number.isInteger(parsed.desiredTightFeeBps) &&
      parsed.desiredTightFeeBps >= DEFAULT_REVENUE_POLICY.desiredTightFeeBps &&
      parsed.desiredTightFeeBps <= cur.tight
    ) {
      return {
        desiredTightFeeBps: parsed.desiredTightFeeBps,
        rationale: `[claude risk signal] ${parsed.rationale}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

const aquaAbi = [
  { type: 'function', name: 'dock', stateMutability: 'nonpayable', inputs: [{ name: 'app', type: 'address' }, { name: 'strategyHash', type: 'bytes32' }, { name: 'tokens', type: 'address[]' }], outputs: [] },
  { type: 'function', name: 'ship', stateMutability: 'nonpayable', inputs: [{ name: 'app', type: 'address' }, { name: 'strategy', type: 'bytes' }, { name: 'tokens', type: 'address[]' }, { name: 'amounts', type: 'uint256[]' }], outputs: [{ type: 'bytes32' }] },
] as const;

async function main() {
  console.log('=== STRATEGIST AGENT ===');
  const state = await (await fetch(`${API_URL}/state`)).json();
  const { swaps, mid, dataSource } = await fetchSwaps();
  const pool = state.pool;
  const cur = { tight: Number(pool.tightFeeBps), wide: Number(pool.wideFeeBps) };

  console.log(`data source: ${dataSource}`);
  console.log(`observed fills: ${swaps.length} | mid price: ${mid.toFixed(2)} tUSD/tETH`);

  const tightS = tierStats(swaps, true, mid, pool.token0);
  const wideS = tierStats(swaps, false, mid, pool.token0);
  console.log(
    `tight tier: ${tightS.count} fills, ${fmt(tightS.normalizedVolumeToken0)} token0-equivalent, avg LP edge ${tightS.avgLpEdgeBps.toFixed(2)} bps`,
  );
  console.log(
    `wide tier:  ${wideS.count} fills, ${fmt(wideS.normalizedVolumeToken0)} token0-equivalent, avg LP edge ${wideS.avgLpEdgeBps.toFixed(2)} bps`,
  );

  const signal = await claudePricingSignal(tightS, wideS, cur);
  const decision = signal
    ? revenueNeutralDecision(
        tightS,
        wideS,
        cur,
        signal.desiredTightFeeBps,
        signal.rationale,
      )
    : heuristicDecision(tightS, wideS, cur);
  console.log(`decision: tight ${cur.tight} -> ${decision.tightFeeBps} bps, wide ${cur.wide} -> ${decision.wideFeeBps} bps`);
  console.log(
    `revenue invariant: target=${decision.policy.targetFeeBps}bps projected=${decision.policy.projectedWeightedFeeBps.toFixed(3)}bps delta=${decision.policy.revenueDeltaBps.toFixed(3)}bps status=${decision.policy.status}`,
  );
  console.log(`rationale: ${decision.rationale}`);

  if (decision.tightFeeBps === cur.tight && decision.wideFeeBps === cur.wide) {
    console.log('no repricing needed; strategy unchanged.');
    console.log(JSON.stringify({
      role: 'strategist',
      changed: false,
      from: cur,
      to: cur,
      targetBlendedFeeBps: decision.policy.targetFeeBps,
      projectedBlendedFeeBps: decision.policy.projectedWeightedFeeBps,
      humanShareBps: decision.policy.humanShareBps,
      revenueDeltaBps: decision.policy.revenueDeltaBps,
      dockTx: null,
      shipTx: null,
      rationale: decision.rationale,
    }));
    return;
  }

  // Aqua strategies are immutable -> dock the old one, ship the new one.
  const tokens = [pool.token0, pool.token1] as `0x${string}`[];
  const dockTx = await wallet.writeContract({
    address: d.aqua,
    abi: aquaAbi,
    functionName: 'dock',
    args: [d.app, pool.strategyHash, tokens],
    chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: dockTx });
  console.log(`docked strategy ${pool.strategyHash.slice(0, 14)}... (tx ${dockTx.slice(0, 14)}...)`);

  const { encodeAbiParameters } = await import('viem');
  const newSalt = `0x${(BigInt(pool.strategyHash) % (1n << 128n) | (1n << 129n)).toString(16).padStart(64, '0')}` as `0x${string}`;
  const newStrategy = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'maker', type: 'address' },
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'wideFeeBps', type: 'uint256' },
          { name: 'tightFeeBps', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
    ],
    [
      {
        maker: wallet.account.address,
        token0: pool.token0,
        token1: pool.token1,
        wideFeeBps: BigInt(decision.wideFeeBps),
        tightFeeBps: BigInt(decision.tightFeeBps),
        salt: newSalt,
      },
    ],
  );
  const shipTx = await wallet.writeContract({
    address: d.aqua,
    abi: aquaAbi,
    functionName: 'ship',
    args: [d.app, newStrategy, tokens, [BigInt(pool.balance0), BigInt(pool.balance1)]],
    chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: shipTx });
  console.log(`shipped re-priced strategy (tx ${shipTx.slice(0, 14)}...)`);

  const after = await (await fetch(`${API_URL}/state`)).json();
  console.log(`active strategy now: tight=${after.pool.tightFeeBps}bps wide=${after.pool.wideFeeBps}bps hash=${after.pool.strategyHash.slice(0, 14)}...`);
  console.log(JSON.stringify({
    role: 'strategist',
    changed: true,
    from: cur,
    to: { tight: Number(after.pool.tightFeeBps), wide: Number(after.pool.wideFeeBps) },
    targetBlendedFeeBps: decision.policy.targetFeeBps,
    projectedBlendedFeeBps: decision.policy.projectedWeightedFeeBps,
    humanShareBps: decision.policy.humanShareBps,
    revenueDeltaBps: decision.policy.revenueDeltaBps,
    dockTx,
    shipTx,
    rationale: decision.rationale,
  }));
}

await main();
