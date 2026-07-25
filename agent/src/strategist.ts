/// Nuthatch-backed risk strategist.
///
/// Nuthatch is the only accepted activity source. The strategist reads its
/// normalized rolling window, derives a bounded policy, commits the exact input
/// and decision as a hash, and asks HumanQuota to apply it. HumanQuota keeps the
/// LP target, recorded volume, token custody, and authorization rules on-chain.
import {
  encodePacked,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';

import {
  KEYS,
  RPC_URL,
  loadDeployments,
  makeWallet,
  publicClient,
} from './lib.js';

const deployments = loadDeployments();
const wallet = makeWallet(
  process.env.POLICY_PRIVATE_KEY
    ? (process.env.POLICY_PRIVATE_KEY as Hex)
    : KEYS.maker,
);

const quotaAbi = [
  {
    type: 'function',
    name: 'feeSchedule',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'tightFeeBps', type: 'uint256' },
      { name: 'wideFeeBps', type: 'uint256' },
      { name: 'targetFeeBps', type: 'uint256' },
      { name: 'humanShareBps', type: 'uint256' },
      { name: 'tightVolume', type: 'uint256' },
      { name: 'wideVolume', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'policyState',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'updater', type: 'address' },
      { name: 'maxFeeStepBps', type: 'uint256' },
      { name: 'maxDataLagBlocks', type: 'uint256' },
      { name: 'indexedThroughBlock', type: 'uint256' },
      { name: 'decisionHash', type: 'bytes32' },
      { name: 'desiredTightFeeBps', type: 'uint256' },
      { name: 'riskSpreadBps', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'applyRiskPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'desiredTightFeeBps', type: 'uint32' },
      { name: 'riskSpreadBps', type: 'uint32' },
      { name: 'indexedThroughBlock', type: 'uint64' },
      { name: 'decisionHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

interface RiskWindow {
  fills: number;
  tightFills: number;
  wideFills: number;
  tightVolumeToken0: number;
  wideVolumeToken0: number;
  tightShareBps: number;
  avgTightFeeBps: number;
  avgWideFeeBps: number;
  avgTightPrice: number;
  avgWidePrice: number;
  indexedTradeBlock: bigint;
  windowStartBlock: bigint;
}

interface SqlResponse {
  rows?: Array<Record<string, unknown>>;
  provenance?: {
    as_of?: number | string;
    sealed_through?: number | string;
    source?: string;
    registry_hash?: string;
  };
  error?: string;
}

function numeric(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Nuthatch risk window has invalid ${key}`);
  }
  return value;
}

function integer(row: Record<string, unknown>, key: string): bigint {
  const value = BigInt(String(row[key]));
  if (value < 0n) throw new Error(`Nuthatch risk window has invalid ${key}`);
  return value;
}

async function loadRiskWindow(): Promise<{
  window: RiskWindow;
  provenance: NonNullable<SqlResponse['provenance']>;
}> {
  const endpoint = process.env.NUTHATCH_URL;
  if (!endpoint) {
    throw new Error('NUTHATCH_URL is required; risk policy has no RPC/event-log fallback');
  }
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error('NUTHATCH_URL must use HTTP or HTTPS');
  }

  const readyResponse = await fetch(new URL('/ready', base), {
    signal: AbortSignal.timeout(5_000),
  });
  const ready = await readyResponse.json() as {
    ready?: boolean;
    stalled?: boolean;
    lag_blocks?: number;
  };
  if (!readyResponse.ok || ready.ready !== true || ready.stalled === true) {
    throw new Error('Nuthatch is not ready; refusing to update on-chain risk policy');
  }

  const query = 'SELECT * FROM turing_risk_window';
  const sqlUrl = new URL('/sql', base);
  sqlUrl.searchParams.set('q', query);
  sqlUrl.searchParams.set('max_rows', '1');
  const response = await fetch(sqlUrl, { signal: AbortSignal.timeout(8_000) });
  const body = await response.json() as SqlResponse;
  if (!response.ok) {
    throw new Error(`Nuthatch SQL ${response.status}: ${body.error ?? 'query failed'}`);
  }
  const row = body.rows?.[0];
  if (!row || !body.provenance) {
    throw new Error('Nuthatch has not indexed a risk window yet');
  }

  const window: RiskWindow = {
    fills: numeric(row, 'fills'),
    tightFills: numeric(row, 'tight_fills'),
    wideFills: numeric(row, 'wide_fills'),
    tightVolumeToken0: numeric(row, 'tight_volume_token0'),
    wideVolumeToken0: numeric(row, 'wide_volume_token0'),
    tightShareBps: numeric(row, 'tight_share_bps'),
    avgTightFeeBps: numeric(row, 'avg_tight_fee_bps'),
    avgWideFeeBps: numeric(row, 'avg_wide_fee_bps'),
    avgTightPrice: numeric(row, 'avg_tight_price'),
    avgWidePrice: numeric(row, 'avg_wide_price'),
    indexedTradeBlock: integer(row, 'indexed_trade_block'),
    windowStartBlock: integer(row, 'window_start_block'),
  };
  if (window.fills < 2 || window.tightFills === 0 || window.wideFills === 0) {
    throw new Error('Nuthatch needs at least one confirmed fill from each risk lane');
  }
  if (Number(ready.lag_blocks ?? 0) > Number(process.env.MAX_NUTHATCH_LAG ?? 300)) {
    throw new Error(`Nuthatch lag is ${ready.lag_blocks} blocks; policy update refused`);
  }
  return { window, provenance: body.provenance };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedStep(current: number, desired: number, maxStep: number): number {
  return Math.round(clamp(desired, current - maxStep, current + maxStep));
}

function derivePolicy(
  risk: RiskWindow,
  current: {
    target: number;
    desiredTight: number;
    riskSpread: number;
    maxStep: number;
  },
) {
  const searcherShareBps = 10_000 - risk.tightShareBps;
  const averagePrice = (risk.avgTightPrice + risk.avgWidePrice) / 2;
  const priceGapBps =
    averagePrice > 0
      ? Math.abs(risk.avgTightPrice - risk.avgWidePrice) / averagePrice * 10_000
      : 0;

  // More verified-retail volume raises the retail floor; more searcher volume
  // funds a deeper retail discount. Price dispersion expands the risk spread.
  const desiredRetail = clamp(
    5 + Math.round(risk.tightShareBps / 750),
    5,
    current.target,
  );
  const desiredSpread = clamp(
    18 + Math.round(searcherShareBps / 400) + Math.round(Math.min(priceGapBps, 25)),
    10,
    80,
  );

  return {
    desiredTightFeeBps: boundedStep(
      current.desiredTight,
      desiredRetail,
      current.maxStep,
    ),
    riskSpreadBps: boundedStep(
      current.riskSpread,
      desiredSpread,
      current.maxStep,
    ),
    searcherShareBps,
    priceGapBps,
  };
}

function policyTargets(): Array<{ quota: Address; token: Address; label: string }> {
  const targets = [
    { quota: deployments.quota, token: deployments.tETH, label: 'primary/tETH' },
    { quota: deployments.quota, token: deployments.tUSD, label: 'primary/tUSD' },
  ];
  if (deployments.demoVaultQuota) {
    targets.push(
      { quota: deployments.demoVaultQuota, token: deployments.tETH, label: 'vault/tETH' },
      { quota: deployments.demoVaultQuota, token: deployments.tUSD, label: 'vault/tUSD' },
    );
  }
  return targets as Array<{ quota: Address; token: Address; label: string }>;
}

async function applyToTarget(
  target: { quota: Address; token: Address; label: string },
  risk: RiskWindow,
  provenance: NonNullable<SqlResponse['provenance']>,
) {
  const [schedule, state] = await Promise.all([
    publicClient.readContract({
      address: target.quota,
      abi: quotaAbi,
      functionName: 'feeSchedule',
      args: [target.token],
    }),
    publicClient.readContract({
      address: target.quota,
      abi: quotaAbi,
      functionName: 'policyState',
      args: [target.token],
    }),
  ]);
  const [updater, maxStep, maxLag, previousBlock, , desiredTight, riskSpread] = state;
  if (updater.toLowerCase() !== wallet.account.address.toLowerCase()) {
    throw new Error(`${target.label}: strategist wallet is not the configured updater`);
  }
  if (risk.indexedTradeBlock <= previousBlock) {
    return {
      label: target.label,
      changed: false,
      reason: `already applied through block ${previousBlock}`,
    };
  }

  const decision = derivePolicy(risk, {
    target: Number(schedule[2]),
    desiredTight: Number(desiredTight),
    riskSpread: Number(riskSpread),
    maxStep: Number(maxStep),
  });
  const payload = {
    version: 1,
    source: 'nuthatch:turing_risk_window',
    registryHash: provenance.registry_hash ?? null,
    indexedThroughBlock: risk.indexedTradeBlock.toString(),
    quota: target.quota,
    token: target.token,
    window: risk,
    decision,
  };
  const decisionHash = keccak256(
    encodePacked(
      ['bytes'],
      [stringToHex(JSON.stringify(payload, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value))],
    ),
  );
  const hash = await wallet.writeContract({
    address: target.quota,
    abi: quotaAbi,
    functionName: 'applyRiskPolicy',
    args: [
      target.token,
      decision.desiredTightFeeBps,
      decision.riskSpreadBps,
      risk.indexedTradeBlock,
      decisionHash,
    ],
    chain: null,
  });
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`${target.label}: policy transaction reverted`);
  }
  const updated = await publicClient.readContract({
    address: target.quota,
    abi: quotaAbi,
    functionName: 'feeSchedule',
    args: [target.token],
  });
  return {
    label: target.label,
    changed: true,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    indexedThroughBlock: risk.indexedTradeBlock.toString(),
    decisionHash,
    maxDataLagBlocks: maxLag.toString(),
    desiredTightFeeBps: decision.desiredTightFeeBps,
    riskSpreadBps: decision.riskSpreadBps,
    appliedTightFeeBps: updated[0].toString(),
    appliedWideFeeBps: updated[1].toString(),
    targetFeeBps: updated[2].toString(),
  };
}

async function main() {
  console.log('=== NUTHATCH RISK STRATEGIST ===');
  console.log(`RPC: ${new URL(RPC_URL).host}`);
  const { window, provenance } = await loadRiskWindow();
  console.log(
    `Nuthatch window: ${window.fills} fills, block ${window.windowStartBlock}..${window.indexedTradeBlock}, ` +
    `${(window.tightShareBps / 100).toFixed(1)}% verified-retail notional`,
  );

  const results = [];
  for (const target of policyTargets()) {
    const result = await applyToTarget(target, window, provenance);
    results.push(result);
    console.log(
      result.changed
        ? `${result.label}: ${result.appliedTightFeeBps}/${result.appliedWideFeeBps} bps (${result.txHash})`
        : `${result.label}: ${result.reason}`,
    );
  }
  console.log(JSON.stringify({
    role: 'risk-strategist',
    dataSource: 'Nuthatch turing_risk_window',
    indexedThroughBlock: window.indexedTradeBlock.toString(),
    results,
  }));
}

await main();
