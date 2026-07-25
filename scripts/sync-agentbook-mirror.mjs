#!/usr/bin/env node
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const WORLD_AGENT_BOOK_ABI = parseAbi([
  'function lookupHuman(address agent) view returns (uint256 humanId)',
]);
const MIRROR_ABI = parseAbi([
  'function SOURCE_CHAIN_ID() view returns (uint256)',
  'function SOURCE_AGENT_BOOK() view returns (address)',
  'function lookupHuman(address agent) view returns (uint256)',
  'function recordOf(address agent) view returns (uint256 humanId, uint64 sourceBlock, bytes32 sourceBlockHash)',
  'function mirrorHuman(address agent, uint256 humanId, uint64 sourceBlock, bytes32 sourceBlockHash)',
]);

const sourceRpc = required('WORLD_RPC_URL');
const destinationRpc = required('BASE_RPC_URL');
const sourceAgentBook = getAddress(required('SOURCE_AGENT_BOOK'));
const mirror = getAddress(required('AGENT_BOOK_MIRROR'));
const agents = required('MIRROR_AGENTS')
  .split(',')
  .map((agent) => getAddress(agent.trim()));
const account = privateKeyToAccount(required('MIRROR_RELAYER_PRIVATE_KEY'));

const source = createPublicClient({ transport: http(sourceRpc) });
const destination = createPublicClient({ transport: http(destinationRpc) });
const wallet = createWalletClient({ account, transport: http(destinationRpc) });

const [sourceChainId, destinationChainId, mirrorSourceChainId, mirrorSourceAgentBook] =
  await Promise.all([
    source.getChainId(),
    destination.getChainId(),
    destination.readContract({
      address: mirror,
      abi: MIRROR_ABI,
      functionName: 'SOURCE_CHAIN_ID',
    }),
    destination.readContract({
      address: mirror,
      abi: MIRROR_ABI,
      functionName: 'SOURCE_AGENT_BOOK',
    }),
  ]);

if (BigInt(sourceChainId) !== mirrorSourceChainId) {
  throw new Error(`mirror expects source chain ${mirrorSourceChainId}, RPC is ${sourceChainId}`);
}
if (mirrorSourceAgentBook.toLowerCase() !== sourceAgentBook.toLowerCase()) {
  throw new Error('mirror source AgentBook does not match SOURCE_AGENT_BOOK');
}

const sourceBlock = await source.getBlock({ blockTag: 'latest' });
if (!sourceBlock.number || !sourceBlock.hash) throw new Error('source RPC returned an incomplete block');

const results = [];
for (const agent of agents) {
  const [humanId, current] = await Promise.all([
    source.readContract({
      address: sourceAgentBook,
      abi: WORLD_AGENT_BOOK_ABI,
      functionName: 'lookupHuman',
      args: [agent],
      blockNumber: sourceBlock.number,
    }),
    destination.readContract({
      address: mirror,
      abi: MIRROR_ABI,
      functionName: 'recordOf',
      args: [agent],
    }),
  ]);

  if (BigInt(current[1]) >= sourceBlock.number) {
    results.push({
      agent,
      humanId: current[0].toString(),
      sourceBlock: current[1].toString(),
      status: 'already-current',
    });
    continue;
  }

  const transactionHash = await wallet.writeContract({
    address: mirror,
    abi: MIRROR_ABI,
    functionName: 'mirrorHuman',
    args: [agent, humanId, sourceBlock.number, sourceBlock.hash],
    account,
  });
  const receipt = await destination.waitForTransactionReceipt({ hash: transactionHash });
  const mirrored = await destination.readContract({
    address: mirror,
    abi: MIRROR_ABI,
    functionName: 'lookupHuman',
    args: [agent],
  });
  if (mirrored !== humanId) throw new Error(`mirror verification failed for ${agent}`);

  results.push({
    agent,
    humanId: humanId.toString(),
    sourceBlock: sourceBlock.number.toString(),
    transactionHash,
    destinationBlock: receipt.blockNumber.toString(),
    status: 'mirrored',
  });
}

console.log(JSON.stringify({
  sourceChainId,
  destinationChainId,
  sourceAgentBook,
  mirror,
  sourceBlock: sourceBlock.number.toString(),
  sourceBlockHash: sourceBlock.hash,
  results,
}, null, 2));
