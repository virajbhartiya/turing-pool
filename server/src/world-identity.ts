import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
} from 'viem';

import { deployments } from './chain.js';
import { WORLD_AGENTBOOK_CHAIN_ID, WORLD_RPC_URL } from './config.js';

const WORLD_AGENT_BOOK_ABI = parseAbi([
  'function lookupHuman(address agent) view returns (uint256 humanId)',
  'function getNextNonce(address agent) view returns (uint256 nonce)',
]);

const WORLD_REGISTRATION_RELAY =
  process.env.WORLD_AGENTKIT_RELAY_URL ?? 'https://x402-worldchain.vercel.app';

const worldClient = createPublicClient({ transport: http(WORLD_RPC_URL) });

function canonicalAgentBook(): Address {
  return getAddress(deployments.agentBook);
}

function isContractRevert(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /revert|execution reverted|contract function execution|missing revert data/i.test(
    message,
  );
}

/**
 * Reads the nonce used by the identity status response.
 *
 * Some mock AgentBook deployments intentionally omit getNextNonce for wallets
 * that have not been registered. That is an expected "not registered yet"
 * state, but transport and RPC failures must still be visible to callers.
 */
export async function nextNonceForIdentityStatus(
  humanId: bigint,
  readNonce: () => Promise<bigint>,
): Promise<bigint> {
  try {
    return await readNonce();
  } catch (error) {
    if (humanId === 0n && isContractRevert(error)) {
      return 0n;
    }
    throw error;
  }
}

export function parseIdentityAddress(value: unknown): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error('wallet address must be a 20-byte EVM address');
  }
  return getAddress(value);
}

export async function worldIdentityStatus(value: unknown) {
  const address = parseIdentityAddress(value);
  const agentBook = canonicalAgentBook();
  const [sourceBlock, humanId] = await Promise.all([
    worldClient.getBlock({ blockTag: 'latest' }),
    worldClient.readContract({
      address: agentBook,
      abi: WORLD_AGENT_BOOK_ABI,
      functionName: 'lookupHuman',
      args: [address],
    }),
  ]);
  const nonce = await nextNonceForIdentityStatus(humanId, () =>
    worldClient.readContract({
      address: agentBook,
      abi: WORLD_AGENT_BOOK_ABI,
      functionName: 'getNextNonce',
      args: [address],
    }),
  );
  if (sourceBlock.number === null || sourceBlock.hash === null) {
    throw new Error('World Chain returned an incomplete block');
  }

  const worldRegistered = humanId !== 0n;
  return {
    address,
    worldRegistered,
    readyToTradeAsHuman: worldRegistered,
    humanId: humanId.toString(),
    nextNonce: nonce.toString(),
    worldBlock: sourceBlock.number.toString(),
    worldBlockHash: sourceBlock.hash,
    agentBook,
    chainId: WORLD_AGENTBOOK_CHAIN_ID,
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
  const agentBook = canonicalAgentBook();
  const agent = parseIdentityAddress(body.agent);
  if (getAddress(body.contract) !== agentBook) {
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
    body: JSON.stringify({ ...body, agent, contract: agentBook }),
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
