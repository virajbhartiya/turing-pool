import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  padHex,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const deploymentsPath =
  process.env.DEPLOYMENTS_PATH ?? resolve(here, '../../contracts/deployments/demo.json');
const deployments = JSON.parse(readFileSync(deploymentsPath, 'utf8')) as {
  humanAgent: Address;
  humanId: string;
  maker: Address;
  orderData: Hex;
  orderHash: Hex;
  orderTraits: string;
  router: Address;
  tETH: Address;
  tUSD: Address;
};

const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const amountIn = BigInt(process.env.AMOUNT_IN ?? '1000000000000000000');
const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
if (amountIn <= 0n) throw new Error('AMOUNT_IN must be positive');
if (slippageBps < 0n || slippageBps >= 10_000n) {
  throw new Error(`SLIPPAGE_BPS must be between 0 and 9999, got ${slippageBps}`);
}

// Anvil account #2, registered by DeployDemo as the World ID-verified trader.
const humanAgentKey =
  (process.env.HUMAN_AGENT_PRIVATE_KEY as Hex | undefined) ??
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const account = privateKeyToAccount(humanAgentKey);
if (account.address.toLowerCase() !== deployments.humanAgent.toLowerCase()) {
  throw new Error(
    `human agent key resolves to ${account.address}, expected ${deployments.humanAgent}`,
  );
}

const transport = http(rpcUrl);
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });

const orderComponents = [
  { name: 'maker', type: 'address' },
  { name: 'traits', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

const routerAbi = [
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
] as const;

const erc20Abi = [
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

const humanGatedAbi = [
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
] as const;

const order = {
  maker: deployments.maker,
  traits: BigInt(deployments.orderTraits),
  data: deployments.orderData,
};

/**
 * SwapVM taker data begins with ten uint16 slice-end indexes followed by uint16
 * flags. For an exact-in Aqua trade, 0x41 means exact-in + transferFrom/Aqua.push.
 * Supplying a threshold makes every slice end at byte 32 and enforces min output.
 */
function takerTraits(minAmountOut?: bigint): Hex {
  const flags = '0x0041' as Hex;
  if (minAmountOut === undefined) {
    return concatHex([padHex('0x', { size: 20 }), flags]);
  }
  const sliceEnds = `0x${'0020'.repeat(10)}` as Hex;
  return concatHex([sliceEnds, flags, padHex(toHex(minAmountOut), { size: 32 })]);
}

const opcode = await publicClient.readContract({
  address: deployments.router,
  abi: routerAbi,
  functionName: 'humanGateOpcode',
});
if (opcode !== 34n) throw new Error(`unexpected _humanGate opcode: ${opcode}`);

const [quotedAmountIn, quotedAmountOut, quotedOrderHash] = await publicClient.readContract({
  address: deployments.router,
  abi: routerAbi,
  functionName: 'quote',
  args: [order, deployments.tETH, deployments.tUSD, amountIn, takerTraits()],
  account,
});
if (quotedAmountIn !== amountIn || quotedAmountOut <= 0n) {
  throw new Error(`invalid router quote: in=${quotedAmountIn}, out=${quotedAmountOut}`);
}
if (quotedOrderHash.toLowerCase() !== deployments.orderHash.toLowerCase()) {
  throw new Error(`quote returned order ${quotedOrderHash}, expected ${deployments.orderHash}`);
}

const approvalHash = await walletClient.writeContract({
  address: deployments.tETH,
  abi: erc20Abi,
  functionName: 'approve',
  args: [deployments.router, amountIn],
  chain: null,
});
const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
if (approvalReceipt.status !== 'success') throw new Error(`approval reverted: ${approvalHash}`);

const minAmountOut = (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
const safeTakerTraits = takerTraits(minAmountOut);
const simulation = await publicClient.simulateContract({
  address: deployments.router,
  abi: routerAbi,
  functionName: 'swap',
  args: [order, deployments.tETH, deployments.tUSD, amountIn, safeTakerTraits],
  account,
});
const [, simulatedAmountOut] = simulation.result;
if (simulatedAmountOut < minAmountOut) {
  throw new Error(`simulated output ${simulatedAmountOut} is below minimum ${minAmountOut}`);
}

const txHash = await walletClient.writeContract({
  ...simulation.request,
  chain: null,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== 'success') throw new Error(`router swap reverted: ${txHash}`);

const humanGated = receipt.logs
  .filter((log) => log.address.toLowerCase() === deployments.router.toLowerCase())
  .map((log) => {
    try {
      return decodeEventLog({
        abi: humanGatedAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      return undefined;
    }
  })
  .find((decoded) => decoded?.eventName === 'HumanGated');

if (!humanGated || humanGated.eventName !== 'HumanGated') {
  throw new Error(`transaction ${txHash} did not emit HumanGated`);
}
if (
  humanGated.args.orderHash.toLowerCase() !== deployments.orderHash.toLowerCase() ||
  humanGated.args.taker.toLowerCase() !== account.address.toLowerCase() ||
  humanGated.args.humanId !== BigInt(deployments.humanId) ||
  !humanGated.args.tight
) {
  throw new Error(`HumanGated event did not prove the expected World ID-verified tight execution`);
}

console.log(
  `_humanGate(${opcode}) → XYC swap: ${formatUnits(amountIn, 18)} tETH → ${formatUnits(simulatedAmountOut, 18)} tUSD`,
);
console.log(
  JSON.stringify({
    role: 'router',
    opcode: Number(opcode),
    event: humanGated.eventName,
    txHash,
    amountOut: simulatedAmountOut.toString(),
  }),
);
