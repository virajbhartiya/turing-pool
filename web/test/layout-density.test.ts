import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('execution detail stays bounded and dense proof data uses progressive disclosure', async () => {
  const [terminal, controller, evidence, styles] = await Promise.all([
    readFile(new URL('../src/components/TradingTerminal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/FeeControllerPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/EvidenceLedger.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
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
  assert.match(evidence, /<details[^>]*className="ledger-panel"/);
  assert.match(evidence, /<summary/);
  assert.doesNotMatch(
    controller,
    /proof-rail/,
    'the live trace already explains execution, so the controller must not repeat the same proof sequence',
  );
});
