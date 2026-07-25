#!/usr/bin/env node

import { createServer } from 'node:http';

const upstreamUrl = process.env.RPC_UPSTREAM_URL;
if (!upstreamUrl) {
  throw new Error('RPC_UPSTREAM_URL is required');
}

const port = Number(process.env.RPC_PROXY_PORT ?? '8546');
const maxLogBlockRange = BigInt(process.env.RPC_MAX_LOG_BLOCK_RANGE ?? '10');
const minimumIntervalMs = Number(process.env.RPC_MIN_INTERVAL_MS ?? '150');
const maxRetries = Number(process.env.RPC_MAX_RETRIES ?? '6');

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('RPC_PROXY_PORT must be a valid TCP port');
}
if (maxLogBlockRange <= 0n) {
  throw new Error('RPC_MAX_LOG_BLOCK_RANGE must be greater than zero');
}

let nextRequestAt = 0;
let requestQueue = Promise.resolve();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scheduleUpstreamRequest(task) {
  const scheduled = requestQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait > 0) await delay(wait);
    nextRequestAt = Date.now() + minimumIntervalMs;
    return task();
  });
  requestQueue = scheduled.catch(() => undefined);
  return scheduled;
}

function isRateLimited(status, payload) {
  if (status === 429) return true;
  const message =
    payload && typeof payload === 'object' && payload.error
      ? `${payload.error.code ?? ''} ${payload.error.message ?? ''}`
      : '';
  return /\b429\b|too many requests|rate[ -]?limit|compute units per second/i.test(message);
}

async function upstream(request) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await scheduleUpstreamRequest(async () => {
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => ({
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: {
          code: -32_000,
          message: `RPC upstream returned HTTP ${response.status}`,
        },
      }));
      return { status: response.status, payload };
    });

    if (!isRateLimited(result.status, result.payload) || attempt === maxRetries) {
      return result.payload;
    }
    await delay(Math.min(8_000, 500 * 2 ** attempt));
  }
  throw new Error('unreachable');
}

function hexBlock(value) {
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)
    ? BigInt(value)
    : undefined;
}

function logOrder(left, right) {
  const fields = ['blockNumber', 'transactionIndex', 'logIndex'];
  for (const field of fields) {
    const leftValue = hexBlock(left?.[field]) ?? 0n;
    const rightValue = hexBlock(right?.[field]) ?? 0n;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

function logKey(log) {
  return [
    log?.blockHash ?? '',
    log?.transactionHash ?? '',
    log?.logIndex ?? '',
  ].join(':');
}

async function handleRpc(request) {
  if (
    !request ||
    typeof request !== 'object' ||
    request.method !== 'eth_getLogs' ||
    !Array.isArray(request.params)
  ) {
    return upstream(request);
  }

  const filter = request.params[0];
  if (!filter || typeof filter !== 'object') return upstream(request);

  const fromBlock = hexBlock(filter.fromBlock);
  const toBlock = hexBlock(filter.toBlock);
  if (fromBlock === undefined || toBlock === undefined || toBlock < fromBlock) {
    return upstream(request);
  }
  if (toBlock - fromBlock + 1n <= maxLogBlockRange) {
    return upstream(request);
  }

  const merged = [];
  for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += maxLogBlockRange) {
    const chunkEnd =
      chunkStart + maxLogBlockRange - 1n < toBlock
        ? chunkStart + maxLogBlockRange - 1n
        : toBlock;
    const response = await upstream({
      ...request,
      params: [
        {
          ...filter,
          fromBlock: `0x${chunkStart.toString(16)}`,
          toBlock: `0x${chunkEnd.toString(16)}`,
        },
        ...request.params.slice(1),
      ],
    });
    if (response?.error) {
      return { ...response, id: request.id ?? null };
    }
    if (Array.isArray(response?.result)) merged.push(...response.result);
  }

  const uniqueLogs = [...new Map(merged.map((log) => [logKey(log), log])).values()];
  uniqueLogs.sort(logOrder);
  return {
    jsonrpc: request.jsonrpc ?? '2.0',
    id: request.id ?? null,
    result: uniqueLogs,
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', maxLogBlockRange: maxLogBlockRange.toString() }));
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'JSON-RPC requests must use POST' }));
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request));
    const result = Array.isArray(payload)
      ? await Promise.all(payload.map(handleRpc))
      : await handleRpc(payload);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error('[rpc-log-proxy] request failed', error);
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32_000, message: 'RPC proxy request failed' },
      }),
    );
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    `[rpc-log-proxy] listening on http://127.0.0.1:${port} (eth_getLogs max ${maxLogBlockRange} blocks)`,
  );
});

function shutdown(signal) {
  console.log(`[rpc-log-proxy] ${signal} received; closing`);
  server.close();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
