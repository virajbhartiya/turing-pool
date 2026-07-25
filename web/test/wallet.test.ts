import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.equal(parseChainId('0x14a34'), EXECUTION_CHAIN_ID);
  assert.equal(parseChainId('480'), undefined);
});

test('Base Sepolia is added and selected when MetaMask does not know the network', async () => {
  const methods: string[] = [];
  const provider: Eip1193Provider = {
    async request({ method }) {
      methods.push(method);
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') {
        throw Object.assign(new Error('unknown chain'), { code: 4902 });
      }
      if (method === 'wallet_addEthereumChain') return null;
      throw new Error(`unexpected method ${method}`);
    },
  };

  await ensureExecutionChain(provider);
  assert.deepEqual(methods, [
    'eth_chainId',
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
  ]);
});
