export const STRATEGIST_QUERY = `query StrategistInput($app: Bytes!) {
  swaps(first: 500, orderBy: blockNumber, orderDirection: desc) {
    tight
    tokenIn
    amountIn
    amountOut
    feeBps
  }
  strategies(
    first: 1
    orderBy: shippedAtBlock
    orderDirection: desc
    where: { active: true, app: $app }
  ) {
    balance0
    balance1
  }
}`;

export interface StrategistSwap {
  tight: boolean;
  tokenIn: string;
  amountIn: string;
  amountOut: string;
  feeBps: string;
}

export interface StrategistGraphData {
  swaps: StrategistSwap[];
  strategies: [
    { balance0: string; balance1: string },
    ...Array<{ balance0: string; balance1: string }>,
  ];
}

interface GraphResponse {
  data?: {
    swaps?: StrategistSwap[];
    strategies?: Array<{ balance0?: string; balance1?: string }>;
  };
  errors?: Array<{ message?: string }>;
}

export function requireStrategistGraphData(body: unknown): StrategistGraphData {
  if (body === null || typeof body !== 'object') {
    throw new Error('The Graph returned a non-object response');
  }

  const response = body as GraphResponse;
  if (response.errors?.length) {
    const messages = response.errors.map((error) => error.message ?? 'unknown GraphQL error');
    throw new Error(`The Graph query failed: ${messages.join('; ')}`);
  }
  if (!response.data || !Array.isArray(response.data.swaps) || !Array.isArray(response.data.strategies)) {
    throw new Error('The Graph response is missing strategist data');
  }
  if (response.data.strategies.length === 0) {
    throw new Error('The Graph returned no active strategy for the configured app');
  }

  const strategy = response.data.strategies[0];
  if (
    !strategy ||
    typeof strategy.balance0 !== 'string' ||
    typeof strategy.balance1 !== 'string' ||
    !isPositiveInteger(strategy.balance0) ||
    !isPositiveInteger(strategy.balance1)
  ) {
    throw new Error('The Graph returned invalid active-strategy balances');
  }

  return response.data as StrategistGraphData;
}

function isPositiveInteger(value: string): boolean {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}
