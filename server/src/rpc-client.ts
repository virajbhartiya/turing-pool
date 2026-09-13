import { createPublicClient, http } from 'viem';
import { worldchain } from 'viem/chains';

export function createReadClient(rpcUrl: string, chainId: number) {
  const world = chainId === worldchain.id;
  return createPublicClient({
    chain: world ? worldchain : undefined,
    // Coalesce simultaneous read-only calls, without caching market safety data.
    // Viem excludes eth_call requests with `from`/account or transaction fields
    // from Multicall3, preserving msg.sender for identity-dependent quote paths.
    batch: { multicall: world ? { wait: 10, batchSize: 8_192 } : false },
    transport: http(rpcUrl, { batch: { wait: 10, batchSize: 50 } }),
  });
}
