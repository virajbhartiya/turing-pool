import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the bare localhost entry point canonicalizes to the complete Autopilot demo', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(
    app,
    /replaceState\([^\n]+#autopilot/,
    'opening / directly should establish #autopilot as the visible, shareable route',
  );
});
