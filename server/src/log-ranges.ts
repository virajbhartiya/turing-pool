export const MAX_LOG_BLOCK_RANGE = 10n;

interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}

export interface BlockRangeLogClient<TLog, TParams extends object> {
  getLogs(args: TParams & BlockRange): Promise<readonly TLog[]>;
}

/**
 * Reads an inclusive block interval without exceeding RPC log-range limits.
 * Chunks are requested sequentially and concatenated in ascending block order.
 */
export async function getLogsInBlockChunks<TLog, TParams extends object>(
  client: BlockRangeLogClient<TLog, TParams>,
  params: TParams,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<TLog[]> {
  if (toBlock < fromBlock) return [];

  const logs: TLog[] = [];
  for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += MAX_LOG_BLOCK_RANGE) {
    const chunkEnd =
      chunkStart + MAX_LOG_BLOCK_RANGE - 1n < toBlock
        ? chunkStart + MAX_LOG_BLOCK_RANGE - 1n
        : toBlock;
    const chunk = await client.getLogs({
      ...params,
      fromBlock: chunkStart,
      toBlock: chunkEnd,
    });
    logs.push(...chunk);
  }
  return logs;
}
