import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function loopbackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Demo activity requires a loopback HTTP origin with no credentials.');
  }
  return url.origin;
}

export function assertSandbox(state, chainId, clientVersion) {
  if (chainId !== '0x7a69' || !/anvil/i.test(clientVersion) || state.runtime?.chainId !== 31337 || state.contracts?.mockAgentBook !== true || !state.execution?.enabled || !state.execution?.serverOperated) {
    throw new Error('Refusing activity: a local Anvil chain, mock identity and enabled demo execution are required.');
  }
}

export function nextTrade(index, previous) {
  const lane = Math.floor(index / 2) % 2 === 0 ? 'human' : 'bot';
  if (index % 2 === 1) {
    if (!previous || previous.lane !== lane || !/^[1-9][0-9]*$/.test(previous.amountOut)) throw new Error('A confirmed sell receipt is required before buying back.');
    return { lane, direction: 'tUSD-to-tETH', amountIn: previous.amountOut };
  }
  // Bounded variation makes movement visible without draining either side.
  const sizes = ['500000000000000', '800000000000000', '1200000000000000', '650000000000000'];
  return { lane, direction: 'tETH-to-tUSD', amountIn: sizes[Math.floor(index / 2) % sizes.length] };
}

export function positiveInteger(value, fallback, min, max) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`Expected an integer between ${min} and ${max}.`);
  return parsed;
}

async function main() {
  const api = loopbackUrl(process.env.DEMO_MARKET_API ?? 'http://127.0.0.1:4022');
  const rpc = loopbackUrl(process.env.DEMO_MARKET_RPC ?? 'http://127.0.0.1:8546');
  const interval = positiveInteger(process.env.DEMO_MARKET_INTERVAL_MS, 8000, 1000, 60000);
  const duration = positiveInteger(process.env.DEMO_MARKET_DURATION_SECONDS, 43200, 30, 43200);
  const maxTrades = positiveInteger(process.env.DEMO_MARKET_MAX_TRADES, 5000, 1, 10000);
  const statusPath = resolve(process.env.DEMO_MARKET_STATUS ?? '.data/demo-market/status.json');
  mkdirSync(resolve(statusPath, '..'), { recursive: true });
  const startedAt = Date.now();
  const controller = new AbortController();
  let stopping = false;
  let status = { mode: 'isolated-anvil', running: true, pid: process.pid, startedAt: new Date(startedAt).toISOString(), api, intervalMs: interval, confirmed: 0, lastTrade: null, error: null };
  function save() {
    const temporary = `${statusPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2));
    renameSync(temporary, statusPath);
  }
  function stop() { stopping = true; controller.abort(); }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  async function json(url, body, headers = {}) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(`${new URL(url).pathname}: ${result.error?.message ?? result.error ?? response.status}`);
    return result;
  }
  async function guard() {
    const [state, chain, client] = await Promise.all([
      json(`${api}/state`),
      json(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      json(rpc, { jsonrpc: '2.0', id: 2, method: 'web3_clientVersion', params: [] }),
    ]);
    assertSandbox(state, chain.result, client.result);
    return state;
  }
  let previous;
  save();
  try {
    await guard();
    console.log(`Demo activity on ${api}: alternating both lanes every ${interval / 1000}s; maximum ${duration / 3600} hours. Ctrl-C stops after the current receipt.`);
    for (let index = 0; !stopping && index < maxTrades && Date.now() - startedAt < duration * 1000; index++) {
      await guard();
      if (stopping) break;
      const trade = nextTrade(index, previous);
      // Never retry a submission: a lost HTTP response may already have mined.
      const result = await json(`${api}/market/trade`, trade, { origin: api });
      if (!/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash ?? '') || result.amountIn !== trade.amountIn || result.direction !== trade.direction || result.lane !== trade.lane) {
        throw new Error('Trade response failed receipt matching. Inspect the chain before restarting.');
      }
      previous = result;
      status = { ...status, confirmed: index + 1, lastTrade: { ...trade, amountOut: result.amountOut, transactionHash: result.transactionHash, blockNumber: result.blockNumber, tier: result.tier } };
      save();
      console.log(JSON.stringify({ event: 'confirmed', count: status.confirmed, ...status.lastTrade }));
      // Prove activity actually reached the UI's state endpoint.
      let indexed = false;
      for (let attempt = 0; attempt < 12 && !stopping; attempt++) {
        const state = await json(`${api}/state`);
        indexed = state.swaps.some((swap) => swap.transactionHash?.toLowerCase() === result.transactionHash.toLowerCase());
        if (indexed) break;
        await delay(1000, undefined, { signal: controller.signal }).catch(() => {});
      }
      if (!indexed && !stopping) throw new Error('Mined trade did not reach dashboard activity. Stopped for inspection.');
      if (!stopping) await delay(interval, undefined, { signal: controller.signal }).catch(() => {});
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    console.error(status.error);
    process.exitCode = 1;
  } finally {
    status.running = false;
    save();
    console.log(`Demo activity stopped after ${status.confirmed} confirmed trades.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
