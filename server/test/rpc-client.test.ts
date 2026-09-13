import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, multicall3Abi, type Hex } from 'viem';
import { createReadClient } from '../src/rpc-client.js';

const token = '0x1111111111111111111111111111111111111111';
const owner = '0x2222222222222222222222222222222222222222';
const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
type RpcRequest = { id: number; method: string; params: any[] };

async function rpcFixture(action: (url: string, requests: RpcRequest[], envelopes: unknown[]) => Promise<void>) {
  const requests: RpcRequest[] = [];
  const envelopes: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    envelopes.push(body);
    function answer(rpc: RpcRequest) {
      requests.push(rpc);
      let result: Hex = '0x64';
      if (rpc.method === 'eth_call') {
        if (rpc.params[0].to?.toLowerCase() === multicall) {
          const decoded = decodeFunctionData({ abi: multicall3Abi, data: rpc.params[0].data });
          assert.equal(decoded.functionName, 'aggregate3');
          const calls = decoded.args[0] as readonly { callData: Hex }[];
          result = encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: calls.map(() => ({ success: true, returnData: encodeAbiParameters([{ type: 'uint256' }], [42n]) })) });
        } else result = encodeAbiParameters([{ type: 'uint256' }], [42n]);
      }
      return { jsonrpc: '2.0', id: rpc.id, result };
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await action(`http://127.0.0.1:${address.port}`, requests, envelopes); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test('World Chain simultaneous account-free contract reads coalesce into one Multicall3 eth_call', async () => {
  await rpcFixture(async (url, requests) => {
    const client = createReadClient(url, 480);
    const balances = await Promise.all([owner, token, multicall].map((address) => client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] })));
    assert.deepEqual(balances, [42n, 42n, 42n]);
    const calls = requests.filter((request) => request.method === 'eth_call');
    assert.equal(calls.length, 1, 'three independent reads must consume only one eth_call');
    assert.equal(calls[0].params[0].to.toLowerCase(), multicall);
  });
});

test('account-bound quote calls retain their from address and never route through Multicall3', async () => {
  await rpcFixture(async (url, requests, envelopes) => {
    const client = createReadClient(url, 480);
    await Promise.all([owner, token].map((account) => client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], account: account as Hex })));
    const calls = requests.filter((request) => request.method === 'eth_call');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((request) => request.params[0].from).sort(), [owner, token].sort());
    assert.ok(calls.every((request) => request.params[0].to.toLowerCase() === token));
    assert.equal(envelopes.length, 1, 'account-bound calls can safely share an HTTP envelope');
    assert.ok(Array.isArray(envelopes[0]));
  });
});

test('local Anvil contract reads stay direct without requiring a Multicall3 deployment', async () => {
  await rpcFixture(async (url, requests) => {
    const client = createReadClient(url, 31337);
    await Promise.all([owner, token].map((address) => client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] })));
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.params[0].to.toLowerCase() === token));
  });
});
