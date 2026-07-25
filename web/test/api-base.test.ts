import assert from 'node:assert/strict';
import test from 'node:test';

import { apiBase } from '../src/hooks/useProtocol';

test('section hash navigation never replaces the API origin', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        hash: '#risk',
        origin: 'http://localhost:4021',
      },
    },
  });

  try {
    assert.equal(apiBase(), 'http://localhost:4021');
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});
