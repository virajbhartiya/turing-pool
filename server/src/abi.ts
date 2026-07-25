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

export const erc20Abi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const orderComponents = [
  { name: 'maker', type: 'address' },
  { name: 'traits', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

export const vaultFactoryAbi = [
  {
    type: 'function',
    name: 'allVaults',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'isVault',
    stateMutability: 'view',
    inputs: [{ name: 'vault', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'quotaOf',
    stateMutability: 'view',
    inputs: [{ name: 'vault', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ROUTER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'createVault',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'manager', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'dailyCap0', type: 'uint256' },
          { name: 'dailyCap1', type: 'uint256' },
          { name: 'targetFeeBps', type: 'uint32' },
          { name: 'desiredTightFeeBps', type: 'uint32' },
          { name: 'maxWideFeeBps', type: 'uint32' },
          { name: 'initialTightFeeBps', type: 'uint32' },
          { name: 'initialWideFeeBps', type: 'uint32' },
          { name: 'seedToken0TightVolume', type: 'uint128' },
          { name: 'seedToken0WideVolume', type: 'uint128' },
          { name: 'seedToken1TightVolume', type: 'uint128' },
          { name: 'seedToken1WideVolume', type: 'uint128' },
        ],
      },
    ],
    outputs: [
      { name: 'vault', type: 'address' },
      { name: 'quota', type: 'address' },
    ],
  },
] as const;

export const vaultAbi = [
  {
    type: 'event',
    name: 'LiquidityAdded',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'LiquidityRemoved',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'function',
    name: 'TOKEN0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'TOKEN1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'QUOTA',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ROUTER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'previewDeposit',
    stateMutability: 'view',
    inputs: [
      { name: 'maxAmount0', type: 'uint256' },
      { name: 'maxAmount1', type: 'uint256' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'previewRedeem',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'currentOrderHash',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'currentOrder',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: orderComponents,
      },
    ],
  },
  {
    type: 'function',
    name: 'strategyActive',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'maxAmount0', type: 'uint256' },
      { name: 'maxAmount1', type: 'uint256' },
      { name: 'minShares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'minAmount0', type: 'uint256' },
      { name: 'minAmount1', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const;

export const routerAbi = [
  {
    type: 'function',
    name: 'hash',
    stateMutability: 'view',
    inputs: [{ name: 'order', type: 'tuple', components: orderComponents }],
    outputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'humanGateOpcode',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      { name: 'order', type: 'tuple', components: orderComponents },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraitsAndData', type: 'bytes' },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'order', type: 'tuple', components: orderComponents },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraitsAndData', type: 'bytes' },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'HumanGated',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: true },
      { name: 'taker', type: 'address', indexed: true },
      { name: 'humanId', type: 'uint256', indexed: true },
      { name: 'tight', type: 'bool', indexed: false },
      { name: 'feeE9', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'maker', type: 'address', indexed: false },
      { name: 'taker', type: 'address', indexed: false },
      { name: 'tokenIn', type: 'address', indexed: false },
      { name: 'tokenOut', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
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
