type Fetcher = typeof fetch;

export interface IndexedSwap {
  blockNumber: string;
  transactionHash: `0x${string}`;
  taker: `0x${string}`;
  humanId: string;
  tight: boolean;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountOut: string;
  feeBps: string;
  source: 'swapvm';
}

export interface NuthatchActivitySummary {
  fills: number;
  tightFills: number;
  wideFills: number;
  tightVolume: string;
  wideVolume: string;
  humanShareBps: number;
  indexedTradeBlock: string | null;
}

export interface IndexedFeeSchedule {
  pool: 'primary' | 'vault';
  blockNumber: string;
  transactionHash: `0x${string}`;
  token: `0x${string}`;
  tightFeeBps: number;
  wideFeeBps: number;
  humanShareBps: number;
}

export interface NuthatchRiskWindow {
  fills: number;
  tightFills: number;
  wideFills: number;
  tightVolumeToken0: string;
  wideVolumeToken0: string;
  tightShareBps: number;
  avgTightFeeBps: number;
  avgWideFeeBps: number;
  avgTightPrice: string;
  avgWidePrice: string;
  indexedTradeBlock: string;
  windowStartBlock: string;
}

export interface NuthatchActivity {
  status: 'connected';
  indexedBlock: string;
  sealedThrough: string | null;
  lagBlocks: number;
  registryHash: string | null;
  provenance: string;
  swaps: IndexedSwap[];
  feeHistory: IndexedFeeSchedule[];
  summary: NuthatchActivitySummary;
  riskWindow: NuthatchRiskWindow | null;
}

interface NuthatchReady {
  ready?: boolean;
  stalled?: boolean;
  tip?: number | string;
  last_block?: number | string;
  lag_blocks?: number | string;
  sealed_through?: number | string | null;
}

interface SqlResponse {
  rows?: unknown[];
  provenance?: {
    as_of?: number | string | null;
    sealed_through?: number | string | null;
    source?: string;
    registry_hash?: string | null;
  };
  error?: string;
}

const TRADE_SQL = `
  SELECT
    block_number,
    tx_hash,
    order_hash,
    taker,
    human_id,
    tight,
    token_in,
    token_out,
    amount_in,
    amount_out,
    fee_bps
  FROM turing_all_trades
  ORDER BY block_number DESC, log_index DESC
`;

const ACTIVITY_SQL = 'SELECT * FROM turing_activity_mix';
const FEE_HISTORY_SQL = `
  SELECT
    pool,
    block_number,
    tx_hash,
    token,
    tight_fee_bps,
    wide_fee_bps,
    human_share_bps
  FROM turing_fee_history
  ORDER BY block_number DESC, log_index DESC
`;
const RISK_WINDOW_SQL = 'SELECT * FROM turing_risk_window';
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function normalizeNuthatchUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Nuthatch URL must use HTTP or HTTPS');
  }
  return url.toString().replace(/\/$/, '');
}

async function getJson<T>(url: string, fetcher: Fetcher): Promise<T> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(4_000) });
  const body = await response.json().catch(() => undefined) as T | undefined;
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? `: ${body.error}`
        : '';
    throw new Error(`Nuthatch HTTP ${response.status}${detail}`);
  }
  if (body === undefined) throw new Error('Nuthatch returned an invalid JSON response');
  return body;
}

function text(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error(`Nuthatch row has invalid ${field}`);
}

function integer(value: unknown, field: string): number {
  const parsed = Number(text(value, field));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Nuthatch row has invalid ${field}`);
  }
  return parsed;
}

function decimal(value: unknown, field: string): number {
  const parsed = Number(text(value, field));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Nuthatch row has invalid ${field}`);
  }
  return parsed;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  throw new Error(`Nuthatch row has invalid ${field}`);
}

function address(value: unknown, field: string): `0x${string}` {
  const parsed = text(value, field);
  if (!HEX_ADDRESS.test(parsed)) throw new Error(`Nuthatch row has invalid ${field}`);
  return parsed as `0x${string}`;
}

function hash(value: unknown, field: string): `0x${string}` {
  const parsed = text(value, field);
  if (!HEX_HASH.test(parsed)) throw new Error(`Nuthatch row has invalid ${field}`);
  return parsed as `0x${string}`;
}

function pool(value: unknown): 'primary' | 'vault' {
  if (value === 'primary' || value === 'vault') return value;
  throw new Error('Nuthatch row has invalid pool');
}

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Nuthatch SQL returned a non-object row');
  }
  return value as Record<string, unknown>;
}

function parseSwap(value: unknown): IndexedSwap {
  const row = rowObject(value);
  return {
    blockNumber: text(row.block_number, 'block_number'),
    transactionHash: hash(row.tx_hash, 'tx_hash'),
    taker: address(row.taker, 'taker'),
    humanId: text(row.human_id, 'human_id'),
    tight: boolean(row.tight, 'tight'),
    tokenIn: address(row.token_in, 'token_in'),
    tokenOut: address(row.token_out, 'token_out'),
    amountIn: text(row.amount_in, 'amount_in'),
    amountOut: text(row.amount_out, 'amount_out'),
    feeBps: text(row.fee_bps, 'fee_bps'),
    source: 'swapvm',
  };
}

function parseSummary(value: unknown): NuthatchActivitySummary {
  const row = rowObject(value);
  return {
    fills: integer(row.fills, 'fills'),
    tightFills: integer(row.tight_fills, 'tight_fills'),
    wideFills: integer(row.wide_fills, 'wide_fills'),
    tightVolume: text(row.tight_volume, 'tight_volume'),
    wideVolume: text(row.wide_volume, 'wide_volume'),
    humanShareBps: integer(row.human_share_bps ?? 0, 'human_share_bps'),
    indexedTradeBlock:
      row.indexed_trade_block === null || row.indexed_trade_block === undefined
        ? null
        : text(row.indexed_trade_block, 'indexed_trade_block'),
  };
}

function parseFeeSchedule(value: unknown): IndexedFeeSchedule {
  const row = rowObject(value);
  return {
    pool: pool(row.pool),
    blockNumber: text(row.block_number, 'block_number'),
    transactionHash: hash(row.tx_hash, 'tx_hash'),
    token: address(row.token, 'token'),
    tightFeeBps: integer(row.tight_fee_bps, 'tight_fee_bps'),
    wideFeeBps: integer(row.wide_fee_bps, 'wide_fee_bps'),
    humanShareBps: integer(row.human_share_bps, 'human_share_bps'),
  };
}

function parseRiskWindow(value: unknown): NuthatchRiskWindow {
  const row = rowObject(value);
  return {
    fills: integer(row.fills, 'fills'),
    tightFills: integer(row.tight_fills, 'tight_fills'),
    wideFills: integer(row.wide_fills, 'wide_fills'),
    tightVolumeToken0: text(row.tight_volume_token0, 'tight_volume_token0'),
    wideVolumeToken0: text(row.wide_volume_token0, 'wide_volume_token0'),
    tightShareBps: integer(row.tight_share_bps, 'tight_share_bps'),
    avgTightFeeBps: decimal(row.avg_tight_fee_bps, 'avg_tight_fee_bps'),
    avgWideFeeBps: decimal(row.avg_wide_fee_bps, 'avg_wide_fee_bps'),
    avgTightPrice: text(row.avg_tight_price, 'avg_tight_price'),
    avgWidePrice: text(row.avg_wide_price, 'avg_wide_price'),
    indexedTradeBlock: text(row.indexed_trade_block, 'indexed_trade_block'),
    windowStartBlock: text(row.window_start_block, 'window_start_block'),
  };
}

export async function loadNuthatchActivity(
  endpoint: string,
  limit = 50,
  fetcher: Fetcher = fetch,
): Promise<NuthatchActivity> {
  const base = normalizeNuthatchUrl(endpoint);
  const rowLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const tradeQuery = `${TRADE_SQL} LIMIT ${rowLimit}`;
  const feeHistoryQuery = `${FEE_HISTORY_SQL} LIMIT ${rowLimit}`;
  // The public/free-tier Nuthatch server deliberately caps concurrent SQL
  // work. Keep this read path serialized so one dashboard refresh cannot
  // self-throttle with its own queries.
  const ready = await getJson<NuthatchReady>(`${base}/ready`, fetcher);
  const trades = await getJson<SqlResponse>(
    `${base}/sql?q=${encodeURIComponent(tradeQuery)}&max_rows=${rowLimit}`,
    fetcher,
  );
  const activity = await getJson<SqlResponse>(
    `${base}/sql?q=${encodeURIComponent(ACTIVITY_SQL)}&max_rows=1`,
    fetcher,
  );
  const feeHistoryResponse = await getJson<SqlResponse>(
    `${base}/sql?q=${encodeURIComponent(feeHistoryQuery)}&max_rows=${rowLimit}`,
    fetcher,
  );
  const riskWindowResponse = await getJson<SqlResponse>(
    `${base}/sql?q=${encodeURIComponent(RISK_WINDOW_SQL)}&max_rows=1`,
    fetcher,
  );
  if (ready.ready !== true || ready.stalled === true) {
    throw new Error('Nuthatch is not ready or has stalled');
  }
  if (
    !Array.isArray(trades.rows) ||
    !Array.isArray(activity.rows) ||
    !Array.isArray(feeHistoryResponse.rows) ||
    !Array.isArray(riskWindowResponse.rows)
  ) {
    throw new Error('Nuthatch SQL response is missing rows');
  }

  const indexedBlock = text(
    trades.provenance?.as_of ?? ready.last_block ?? 0,
    'indexed block',
  );
  const summary = activity.rows[0]
    ? parseSummary(activity.rows[0])
    : {
        fills: 0,
        tightFills: 0,
        wideFills: 0,
        tightVolume: '0',
        wideVolume: '0',
        humanShareBps: 0,
        indexedTradeBlock: null,
      };
  const riskWindowRow = riskWindowResponse.rows[0];
  const riskWindow =
    riskWindowRow &&
    rowObject(riskWindowRow).indexed_trade_block !== null &&
    rowObject(riskWindowRow).indexed_trade_block !== undefined
      ? parseRiskWindow(riskWindowRow)
      : null;

  return {
    status: 'connected',
    indexedBlock,
    sealedThrough:
      trades.provenance?.sealed_through === null ||
      trades.provenance?.sealed_through === undefined
        ? null
        : text(trades.provenance.sealed_through, 'sealed through'),
    lagBlocks: integer(ready.lag_blocks ?? 0, 'lag blocks'),
    registryHash: trades.provenance?.registry_hash ?? null,
    provenance: trades.provenance?.source ?? 'hot+sealed',
    swaps: trades.rows.map(parseSwap).reverse(),
    feeHistory: feeHistoryResponse.rows.map(parseFeeSchedule).reverse(),
    summary,
    riskWindow,
  };
}
