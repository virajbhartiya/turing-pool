import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CHAIN_ID = '84532';
process.env.AGENTKIT_SIGNER_CHAIN_ID = '84532';

test('AgentKit challenge binds the proof to execution while identity stays canonical on World', async () => {
  const [{ default: app }, appSource] = await Promise.all([
    import('../src/app.js'),
    readFile(new URL('../src/app.ts', import.meta.url), 'utf8'),
  ]);

  const response = await app.request('/quote?amountIn=1');
  assert.equal(response.status, 402);

  const challenge = (await response.json()) as {
    extensions: {
      agentkit: {
        supportedChains: Array<{ chainId: string; type: string }>;
      };
    };
  };
  assert.deepEqual(challenge.extensions.agentkit.supportedChains, [
    { chainId: 'eip155:84532', type: 'eip191' },
  ]);

  assert.match(
    appSource,
    /createAgentBookVerifier\(\{\s*rpcUrl:\s*WORLD_RPC_URL,/s,
    'humanId verification must use the official canonical World AgentBook verifier',
  );
  assert.match(
    appSource,
    /payload\.chainId !== AGENTKIT_SIGNER_NETWORK/,
    'the server must reject proofs from a network it did not advertise',
  );
});
