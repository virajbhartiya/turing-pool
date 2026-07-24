export const appAbi = [
  {
    type: 'function',
    name: 'quoteExactIn',
    stateMutability: 'view',
    inputs: [
      {
        name: 'strategy',
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
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'taker', type: 'address' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'tight', type: 'bool' },
      { name: 'feeBps', type: 'uint256' },
      { name: 'humanId', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      { name: 'strategyHash', type: 'bytes32', indexed: true },
      { name: 'taker', type: 'address', indexed: true },
      { name: 'humanId', type: 'uint256', indexed: true },
      { name: 'tight', type: 'bool', indexed: false },
      { name: 'tokenIn', type: 'address', indexed: false },
      { name: 'tokenOut', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
      { name: 'feeBps', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const aquaAbi = [
  {
    type: 'function',
    name: 'safeBalances',
    stateMutability: 'view',
    inputs: [
      { name: 'maker', type: 'address' },
      { name: 'app', type: 'address' },
      { name: 'strategyHash', type: 'bytes32' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
    ],
    outputs: [
      { name: 'balance0', type: 'uint256' },
      { name: 'balance1', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Shipped',
    inputs: [
      { name: 'maker', type: 'address', indexed: false },
      { name: 'app', type: 'address', indexed: false },
      { name: 'strategyHash', type: 'bytes32', indexed: false },
      { name: 'strategy', type: 'bytes', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Docked',
    inputs: [
      { name: 'maker', type: 'address', indexed: false },
      { name: 'app', type: 'address', indexed: false },
      { name: 'strategyHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export const agentBookAbi = [
  {
    type: 'function',
    name: 'lookupHuman',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: 'humanId', type: 'uint256' }],
  },
] as const;

export const quotaAbi = [
  {
    type: 'function',
    name: 'remaining',
    stateMutability: 'view',
    inputs: [
      { name: 'humanId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'dailyCap',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const strategyAbiParams = [
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
] as const;
