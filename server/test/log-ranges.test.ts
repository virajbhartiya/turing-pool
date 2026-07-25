import assert from 'node:assert/strict';
import test from 'node:test';

import { getLogsInBlockChunks } from '../src/log-ranges.js';

test('log scans stay within the Alchemy free-tier 10-block limit', async () => {
  const requests: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const client = {
    async getLogs({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) {
      requests.push({ fromBlock, toBlock });
      if (toBlock - fromBlock + 1n > 10n) {
        throw new Error('You can make eth_getLogs requests with up to a 10 block range');
      }
      return [`${fromBlock}-${toBlock}`];
    },
  };

  const logs = await getLogsInBlockChunks(
    client,
    { address: '0x0000000000000000000000000000000000000001' },
    32_799_777n,
    32_799_802n,
  );

  assert.deepEqual(requests, [
    { fromBlock: 32_799_777n, toBlock: 32_799_786n },
    { fromBlock: 32_799_787n, toBlock: 32_799_796n },
    { fromBlock: 32_799_797n, toBlock: 32_799_802n },
  ]);
  assert.deepEqual(logs, [
    '32799777-32799786',
    '32799787-32799796',
    '32799797-32799802',
  ]);
});
