import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  ensureExecutionChain,
  normalizeAccounts,
  parseChainId,
  EXECUTION_CHAIN_ID,
  type Eip1193Provider,
} from '../src/lib/wallet';

test('wallet account and chain parsing rejects malformed provider responses', () => {
  assert.deepEqual(
    normalizeAccounts([
      '0x0000000000000000000000000000000000000001',
      'not-an-address',
      42,
    ]),
    ['0x0000000000000000000000000000000000000001'],
  );
  assert.equal(parseChainId('0x1e0'), EXECUTION_CHAIN_ID);
  assert.equal(parseChainId('480'), undefined);
});

test('the execution network is added and selected when MetaMask does not know it', async () => {
  const methods: string[] = [];
  let known = false;
  let activeChain = '0x1';
  const provider: Eip1193Provider = {
    async request({ method }) {
      methods.push(method);
      if (method === 'eth_chainId') return activeChain;
      if (method === 'wallet_switchEthereumChain') {
        if (!known) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        activeChain = '0x1e0';
        return null;
      }
      if (method === 'wallet_addEthereumChain') { known = true; return null; }
      throw new Error(`unexpected method ${method}`);
    },
  };

  await ensureExecutionChain(provider);
  assert.deepEqual(methods, [
    'eth_chainId',
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain',
    'eth_chainId',
  ]);
});

test('an explicitly selected Anvil runtime must not switch a demo wallet to World mainnet', async () => {
  const methods: string[] = [];
  const provider: Eip1193Provider = {
    async request({ method }) {
      methods.push(method);
      if (method === 'eth_chainId') return '0x7a69';
      throw new Error('A matching sandbox wallet must not be switched to another network');
    },
  };
  await withOrigin('http://localhost:4030', () => ensureExecutionChain(provider, 31337));
  assert.deepEqual(methods, ['eth_chainId']);
});

async function withOrigin<T>(url: string, run: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const dom = new JSDOM('', { url });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  try { return await run(); }
  finally {
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('unsupported networks and remote Anvil origins are rejected before provider access', async () => {
  const provider: Eip1193Provider = { async request() { throw new Error('Provider must not be called'); } };
  await assert.rejects(ensureExecutionChain(provider, 1), /Unsupported execution network/);
  await withOrigin('https://turingswap.blitlabs.xyz', async () => {
    await assert.rejects(ensureExecutionChain(provider, 31337), /only from localhost/);
  });
});

test('a local demo adds the dedicated RPC and confirms the actual selected chain', async () => {
  let known = false;
  let activeChain = '0x1e0';
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      if (method === 'eth_chainId') return activeChain;
      if (method === 'wallet_switchEthereumChain') {
        assert.deepEqual(params, [{ chainId: '0x7a69' }]);
        if (!known) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        activeChain = '0x7a69';
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        assert.deepEqual(params, [{ chainId: '0x7a69', chainName: 'Turing Local Demo',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['http://127.0.0.1:8546'] }]);
        known = true;
        return null;
      }
      throw new Error(`Unexpected request ${method}`);
    },
  };
  assert.equal(await withOrigin('http://127.0.0.1:4030', () => ensureExecutionChain(provider, 31337)), 31337);
});

test('a wallet claiming switch success while staying on the wrong chain is rejected', async () => {
  const provider: Eip1193Provider = {
    async request({ method }) { return method === 'eth_chainId' ? '0x1' : null; },
  };
  await assert.rejects(ensureExecutionChain(provider), /did not select/);
});
