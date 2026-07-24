import assert from 'node:assert/strict';
import test from 'node:test';

import { getLogsInBlockChunks } from '../src/log-ranges.js';

test('log scans stay within the World Chain public RPC 100-block limit', async () => {
  const requests: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const client = {
    async getLogs({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) {
      requests.push({ fromBlock, toBlock });
      if (toBlock - fromBlock + 1n > 100n) {
        throw new Error('You can make eth_getLogs requests with up to a 100 block range');
      }
      return [`${fromBlock}-${toBlock}`];
    },
  };

  const logs = await getLogsInBlockChunks(
    client,
    { address: '0x0000000000000000000000000000000000000001' },
    32_799_777n,
    32_800_028n,
  );

  assert.deepEqual(requests, [
    { fromBlock: 32_799_777n, toBlock: 32_799_876n },
    { fromBlock: 32_799_877n, toBlock: 32_799_976n },
    { fromBlock: 32_799_977n, toBlock: 32_800_028n },
  ]);
  assert.deepEqual(logs, [
    '32799777-32799876',
    '32799877-32799976',
    '32799977-32800028',
  ]);
});
