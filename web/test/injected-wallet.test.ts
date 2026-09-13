import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useInjectedWallet } from '../src/hooks/useInjectedWallet';

test('wallet initialization reports provider rejection and connection follows the runtime network', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:4030' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  let activeChain = '0x1e0';
  let wallet: ReturnType<typeof useInjectedWallet>;
  window.ethereum = {
    async request({ method, params }) {
      if (method === 'eth_accounts') throw new Error('Wallet is locked');
      if (method === 'eth_chainId') return activeChain;
      if (method === 'eth_requestAccounts') return ['0x0000000000000000000000000000000000000001'];
      if (method === 'wallet_switchEthereumChain') {
        assert.deepEqual(params, [{ chainId: '0x7a69' }]);
        activeChain = '0x7a69';
        return null;
      }
      throw new Error(`Unexpected request ${method}`);
    },
  };
  function Harness() { wallet = useInjectedWallet(31337); return null; }
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(Harness)));
    assert.equal(wallet!.error, 'Wallet is locked');
    await act(async () => wallet!.connect());
    assert.equal(wallet!.chainId, 31337);
    assert.equal(wallet!.correctChain, true);
    assert.equal(wallet!.connected, true);
    assert.equal(wallet!.error, undefined);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
