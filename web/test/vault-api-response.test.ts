import assert from 'node:assert/strict';
import { test } from 'node:test';

import { responseJson } from '../src/lib/apiResponse';

test('vault API failures surface an HTTP error instead of a JSON parser exception', async () => {
  const response = new Response('404 Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

  await assert.rejects(
    responseJson<{ enabled: boolean }>(response),
    /Vault API returned 404.*404 Not Found/,
  );
});

test('vault API failures preserve a structured API error', async () => {
  const response = new Response(JSON.stringify({ error: 'Factory is not configured' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    responseJson<{ enabled: boolean }>(response),
    /Vault API returned 503: Factory is not configured/,
  );
});
