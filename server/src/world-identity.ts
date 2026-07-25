import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

import { client, deployments } from './chain.js';
import { RPC_URL, WORLD_RPC_URL } from './config.js';

const WORLD_AGENT_BOOK_ABI = parseAbi([
  'function lookupHuman(address agent) view returns (uint256 humanId)',
  'function getNextNonce(address agent) view returns (uint256 nonce)',
]);

const MIRROR_ABI = parseAbi([
  'function lookupHuman(address agent) view returns (uint256 humanId)',
  'function recordOf(address agent) view returns (uint256 humanId, uint64 sourceBlock, bytes32 sourceBlockHash)',
  'function mirrorHuman(address agent, uint256 humanId, uint64 sourceBlock, bytes32 sourceBlockHash)',
]);

const WORLD_REGISTRATION_RELAY =
  process.env.WORLD_AGENTKIT_RELAY_URL ?? 'https://x402-worldchain.vercel.app';

const worldClient = createPublicClient({ transport: http(WORLD_RPC_URL) });

function identityContracts() {
  if (
    deployments.identityMode !== 'world-agentbook-mirror' ||
    !deployments.identitySourceAgentBook ||
    !deployments.identityMirror
  ) {
    throw new Error('World identity mirror is not configured for this deployment');
  }
  return {
    source: getAddress(deployments.identitySourceAgentBook),
    mirror: getAddress(deployments.identityMirror),
  };
}

export function parseIdentityAddress(value: unknown): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error('wallet address must be a 20-byte EVM address');
  }
  return getAddress(value);
}

export async function worldIdentityStatus(value: unknown) {
  const address = parseIdentityAddress(value);
  const { source, mirror } = identityContracts();
  const [sourceBlock, humanId, nonce, mirrorRecord] = await Promise.all([
    worldClient.getBlock({ blockTag: 'latest' }),
    worldClient.readContract({
      address: source,
      abi: WORLD_AGENT_BOOK_ABI,
      functionName: 'lookupHuman',
      args: [address],
    }),
    worldClient.readContract({
      address: source,
      abi: WORLD_AGENT_BOOK_ABI,
      functionName: 'getNextNonce',
      args: [address],
    }),
    client.readContract({
      address: mirror,
      abi: MIRROR_ABI,
      functionName: 'recordOf',
      args: [address],
    }),
  ]);
  if (sourceBlock.number === null || sourceBlock.hash === null) {
    throw new Error('World Chain returned an incomplete block');
  }

  const mirroredHumanId = mirrorRecord[0];
  const worldRegistered = humanId !== 0n;
  const mirrorReady = worldRegistered && mirroredHumanId === humanId;
  return {
    address,
    worldRegistered,
    mirrorReady,
    readyToTradeAsHuman: mirrorReady,
    humanId: humanId.toString(),
    mirroredHumanId: mirroredHumanId.toString(),
    nextNonce: nonce.toString(),
    worldBlock: sourceBlock.number.toString(),
    worldBlockHash: sourceBlock.hash,
    mirrorSourceBlock: mirrorRecord[1].toString(),
    sourceAgentBook: source,
    mirror,
    sourceChainId: Number(deployments.identitySourceChainId ?? 480),
    destinationChainId: baseSepolia.id,
    syncAvailable: Boolean(process.env.MIRROR_RELAYER_PRIVATE_KEY),
  };
}

export interface AgentBookRegistration {
  agent: Address;
  root: string;
  nonce: string;
  nullifierHash: string;
  proof: string[];
  contract: Address;
}

export async function relayAgentBookRegistration(body: AgentBookRegistration) {
  const { source } = identityContracts();
  const agent = parseIdentityAddress(body.agent);
  if (getAddress(body.contract) !== source) {
    throw new Error('registration targets a different AgentBook');
  }
  if (
    typeof body.root !== 'string' ||
    typeof body.nonce !== 'string' ||
    typeof body.nullifierHash !== 'string' ||
    !Array.isArray(body.proof) ||
    body.proof.length !== 8 ||
    !body.proof.every(
      (part) =>
        typeof part === 'string' &&
        (/^0x[0-9a-fA-F]{1,64}$/.test(part) || /^[0-9]+$/.test(part)),
    )
  ) {
    throw new Error('World ID registration proof is malformed');
  }

  const response = await fetch(`${WORLD_REGISTRATION_RELAY.replace(/\/$/, '')}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, agent, contract: source }),
    signal: AbortSignal.timeout(30_000),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`World AgentKit relay returned ${response.status}: ${responseBody}`);
  }
  let result: unknown;
  try {
    result = JSON.parse(responseBody);
  } catch {
    throw new Error('World AgentKit relay returned an invalid response');
  }
  return result;
}

export async function syncWorldIdentity(value: unknown) {
  const status = await worldIdentityStatus(value);
  if (!status.worldRegistered || status.humanId === '0') {
    throw new Error('wallet is not registered in the canonical World AgentBook yet');
  }
  if (status.mirrorReady) {
    return { ...status, status: 'already-synchronized' as const, transactionHash: null };
  }

  const privateKey = process.env.MIRROR_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('identity synchronization is not enabled on this server');
  }
  const account = privateKeyToAccount(privateKey);
  const { mirror } = identityContracts();
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });
  const transactionHash = await wallet.writeContract({
    address: mirror,
    abi: MIRROR_ABI,
    functionName: 'mirrorHuman',
    args: [
      status.address,
      BigInt(status.humanId),
      BigInt(status.worldBlock),
      status.worldBlockHash as Hex,
    ],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  const updated = await worldIdentityStatus(status.address);
  if (!updated.mirrorReady) {
    throw new Error('Base mirror transaction mined without publishing the World humanId');
  }
  return {
    ...updated,
    status: 'synchronized' as const,
    transactionHash,
    destinationBlock: receipt.blockNumber.toString(),
  };
}
