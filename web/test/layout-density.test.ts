import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('execution detail stays bounded and dense proof data uses progressive disclosure', async () => {
  const [terminal, autopilot, app, styles] = await Promise.all([
    readFile(new URL('../src/components/TradingTerminal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/AutopilotWorkspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/product.css', import.meta.url), 'utf8'),
  ]);

  assert.match(
    styles,
    /\.execution-trace ol\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s,
    'a long live trace must scroll inside the order ticket instead of extending the entire trading grid',
  );
  assert.match(
    terminal,
    /aria-expanded=/,
    'the full execution trace should be an explicit disclosure rather than permanent page clutter',
  );
  assert.match(autopilot, /<details[^>]*className="autopilot-brain panel-frame"/);
  assert.doesNotMatch(app, /<DemoJourney/);
  assert.match(
    autopilot,
    /reasoning-timeline/,
    'Autopilot should expose the observe, reason, execute, and prove sequence in the primary workspace',
  );
  assert.doesNotMatch(autopilot, /runGuidedDemo|Run live judge demo|executeGuidedTrade/);
});
