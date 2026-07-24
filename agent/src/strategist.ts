/// The Strategist: an autonomous agent that closes the pricing loop.
/// It reads per-tier flow data (subgraph if SUBGRAPH_URL is set, otherwise the
/// API's chain-indexed /state), measures how toxic each tier's flow actually is,
/// decides new spread parameters (Claude reasoning when ANTHROPIC_API_KEY is set,
/// deterministic heuristic otherwise), then DOCKS the running Aqua strategy and
/// SHIPS a re-parameterized one. Aqua strategies are immutable - repricing IS
/// dock+ship, which is exactly what this demonstrates.
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
  volumeIn: bigint;
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
  if (CHAIN_ID !== 31337 || !usesLocalRpc) {
    throw new Error(
      'SUBGRAPH_URL is required outside a local chain-31337 RPC; API fallback is for non-judged local development only',
    );
  }
  const state = await (await fetch(`${API_URL}/state`)).json();
  return {
    swaps: state.swaps,
    mid: Number(state.pool.balance1) / Number(state.pool.balance0),
    pool: state.pool,
    dataSource: 'LOCAL FALLBACK: API /state chain logs (not for judged runs)',
  };
}

function tierStats(swaps: SwapRow[], tight: boolean, mid: number, token0: string): TierStats {
  const rows = swaps.filter((s) => s.tight === tight);
  let volumeIn = 0n;
  let edgeSum = 0;
  for (const s of rows) {
    volumeIn += BigInt(s.amountIn);
    const zeroForOne = s.tokenIn.toLowerCase() === token0.toLowerCase();
    const px = zeroForOne
      ? Number(s.amountOut) / Number(s.amountIn)
      : Number(s.amountIn) / Number(s.amountOut);
    // LP edge: for zeroForOne fills the LP sold token1 at px; if px < current mid
    // the LP sold below where the market went -> negative edge (toxic flow).
    const edgeBps = zeroForOne ? ((mid - px) / mid) * 10_000 : ((px - mid) / mid) * 10_000;
    edgeSum += edgeBps;
  }
  return { count: rows.length, volumeIn, avgLpEdgeBps: rows.length ? edgeSum / rows.length : 0 };
}

interface Decision {
  tightFeeBps: number;
  wideFeeBps: number;
  rationale: string;
}

function heuristicDecision(tightS: TierStats, wideS: TierStats, cur: { tight: number; wide: number }): Decision {
  let tightFee = cur.tight;
  let wideFee = cur.wide;
  const reasons: string[] = [];

  if (tightS.count > 0 && tightS.avgLpEdgeBps > -cur.tight / 2) {
    tightFee = Math.max(2, Math.floor(cur.tight * 0.625)); // e.g. 8 -> 5
    reasons.push(
      `human-backed flow is benign (avg LP edge ${tightS.avgLpEdgeBps.toFixed(2)} bps over ${tightS.count} fills) -> tighten tight tier ${cur.tight} -> ${tightFee} bps`,
    );
  } else if (tightS.count > 0) {
    tightFee = Math.min(cur.wide, cur.tight * 2);
    reasons.push(`human-backed flow shows toxicity -> widen tight tier to ${tightFee} bps`);
  } else {
    reasons.push('no tight-tier fills yet -> keep tight tier');
  }

  if (wideS.count > 0 && wideS.avgLpEdgeBps < -cur.wide) {
    wideFee = Math.min(100, cur.wide + 10);
    reasons.push(`anonymous flow is running over the pool (avg LP edge ${wideS.avgLpEdgeBps.toFixed(2)} bps) -> widen wide tier to ${wideFee} bps`);
  } else {
    reasons.push(`anonymous flow priced adequately at ${cur.wide} bps -> keep wide tier`);
  }

  return { tightFeeBps: tightFee, wideFeeBps: wideFee, rationale: reasons.join('; ') };
}

async function claudeDecision(
  tightS: TierStats,
  wideS: TierStats,
  cur: { tight: number; wide: number },
): Promise<Decision | null> {
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
          'You are the pricing strategist for Turing Pool, an AMM quoting two fee tiers: tight (verified-human-backed takers under a per-human daily cap) and wide (anonymous flow). Positive avgLpEdgeBps means the LP kept edge vs current mid (benign flow); negative means the flow beat the pool (toxic). Reply ONLY with JSON: {"tightFeeBps": int, "wideFeeBps": int, "rationale": string}. Keep 2 <= tightFeeBps < wideFeeBps <= 100.',
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
      Number.isInteger(parsed.tightFeeBps) &&
      Number.isInteger(parsed.wideFeeBps) &&
      parsed.tightFeeBps >= 2 &&
      parsed.tightFeeBps < parsed.wideFeeBps &&
      parsed.wideFeeBps <= 100
    ) {
      return { ...parsed, rationale: `[claude] ${parsed.rationale}` };
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
  console.log(`tight tier: ${tightS.count} fills, ${fmt(tightS.volumeIn)} in, avg LP edge ${tightS.avgLpEdgeBps.toFixed(2)} bps`);
  console.log(`wide tier:  ${wideS.count} fills, ${fmt(wideS.volumeIn)} in, avg LP edge ${wideS.avgLpEdgeBps.toFixed(2)} bps`);

  const decision = (await claudeDecision(tightS, wideS, cur)) ?? heuristicDecision(tightS, wideS, cur);
  console.log(`decision: tight ${cur.tight} -> ${decision.tightFeeBps} bps, wide ${cur.wide} -> ${decision.wideFeeBps} bps`);
  console.log(`rationale: ${decision.rationale}`);

  if (decision.tightFeeBps === cur.tight && decision.wideFeeBps === cur.wide) {
    console.log('no repricing needed; strategy unchanged.');
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
  console.log(JSON.stringify({ role: 'strategist', from: cur, to: { tight: Number(after.pool.tightFeeBps), wide: Number(after.pool.wideFeeBps) }, rationale: decision.rationale }));
}

await main();
