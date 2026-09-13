// Explicit opt-in integration checks using the same transaction preparation API as the UI.
// Keys stay in this process, never in the API, browser, logs, or report.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { worldchain } from 'viem/chains';

const execute = process.argv.includes('--execute');
const simulate = process.argv.includes('--simulate');
const strategyOnly = process.argv.includes('--strategy-only');
const api = process.env.API_URL || 'http://localhost:4030';
const rpc = process.env.RPC_URL || 'https://worldchain-mainnet.gateway.tenderly.co';
const deployment = JSON.parse(readFileSync(new URL('../contracts/deployments/world-mainnet.json', import.meta.url), 'utf8'));
const client = createPublicClient({ chain: worldchain, transport: http(rpc) });
const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const txs = [];
async function request(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${result.error ?? result.code}`);
  return result;
}
assert.equal(await client.getChainId(), 480);
for (const name of ['agentBook', 'aqua', 'app', 'router', 'quota', 'vaultFactory', 'vaultRouter', 'activeVault', 'activeVaultQuota', 'faucet', 'tETH', 'tUSD']) {
  const code = await client.getCode({ address: deployment[name] });
  assert.ok(code && code !== '0x', `${name} not deployed`);
  console.log(`DEPLOYED ${name} ${deployment[name]}`);
}
const state = await request('/state');
assert.equal(state.runtime.chainId, 480);
assert.equal(state.runtime.agentBook, 'live');
assert.equal(state.dataSources.activity.status, 'connected');
assert.equal(state.dataSources.activity.mode, 'sql+mcp');
console.log('LIVE Nuthatch', state.dataSources.activity.indexedBlock);
if (simulate) {
  for (const address of [deployment.humanAgent, deployment.bot]) {
    for (const direction of ['tETH-to-tUSD', 'tUSD-to-tETH']) {
      const amountIn = direction === 'tETH-to-tUSD' ? '100000000000000' : '200000000000000000';
      const prepared = await request('/wallet/prepare', { address, direction, amountIn });
      assert.equal(prepared.quote.humanBacked, address === deployment.humanAgent);
      assert.equal(prepared.quote.amountIn, amountIn);
      await client.call({ account: address, to: prepared.transaction.to, data: prepared.transaction.data });
      console.log('SIMULATED', address === deployment.humanAgent ? 'human' : 'bot', direction, prepared.action, prepared.quote.tier);
    }
  }
  const prepared = await request(`/vaults/${deployment.activeVault}/liquidity/prepare`, {
    address: deployment.humanAgent, action: 'deposit', maxAmount0: '100000000000000', maxAmount1: '400000000000000000',
  });
  await client.call({ account: deployment.humanAgent, to: prepared.transaction.to, data: prepared.transaction.data });
  console.log('SIMULATED liquidity', prepared.action, prepared.preview);
  const redemption = await request(`/vaults/${deployment.activeVault}/liquidity/prepare`, {
    address: deployment.humanAgent, action: 'redeem', shares: '1000000000000000',
  });
  await client.call({ account: deployment.humanAgent, to: redemption.transaction.to, data: redemption.transaction.data });
  console.log('SIMULATED liquidity redemption', redemption.preview);
  const faucet = await request(`/faucet?address=${deployment.bot}`);
  if (faucet.claimable) {
    const claim = await request('/faucet/prepare', { address: deployment.bot });
    await client.call({ account: deployment.bot, to: claim.transaction.to, data: claim.transaction.data });
    console.log('SIMULATED faucet claim');
  } else console.log('FAUCET guarded', faucet.reason);
}
if (!execute) {
  console.log('Read-only checks passed. --execute explicitly enables small test-token transactions and real ETH gas.');
  process.exit(0);
}
const secrets = parseEnv(readFileSync(process.env.LIVE_CHECK_ENV || '.env.production.local', 'utf8'));
for (const key of ['HUMAN_AGENT_PRIVATE_KEY', 'BOT_PRIVATE_KEY']) {
  assert.match(secrets[key] ?? '', /^0x[0-9a-fA-F]{64}$/, `${key} is missing or invalid. Configure it locally; never paste keys into chat.`);
}
const human = privateKeyToAccount(secrets.HUMAN_AGENT_PRIVATE_KEY);
const bot = privateKeyToAccount(secrets.BOT_PRIVATE_KEY);
assert.equal(human.address.toLowerCase(), deployment.humanAgent.toLowerCase());
assert.equal(bot.address.toLowerCase(), deployment.bot.toLowerCase());
const allowedTargets = new Set(['tETH', 'tUSD', 'vaultRouter', 'activeVault', 'faucet'].map((key) => deployment[key].toLowerCase()));
async function send(account, prepared, label) {
  const transaction = prepared.transaction;
  assert.equal(transaction.from.toLowerCase(), account.address.toLowerCase());
  assert.ok(allowedTargets.has(transaction.to.toLowerCase()), 'Unexpected transaction target');
  assert.equal(BigInt(transaction.value ?? 0), 0n, 'Native value transfer is not permitted');
  const input = { account, to: transaction.to, data: transaction.data, value: 0n };
  const gas = (await client.estimateGas(input)) * 120n / 100n;
  const fees = await client.estimateFeesPerGas();
  assert.ok(gas * fees.maxFeePerGas < parseEther('0.00002'), 'Transaction exceeds test gas budget');
  const wallet = createWalletClient({ account, chain: worldchain, transport: http(rpc) });
  const hash = await wallet.sendTransaction({ ...input, gas, ...fees });
  // Log immediately so an interrupted run can reconcile instead of broadcasting twice.
  console.log(`SUBMITTED ${label} ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
  assert.equal(receipt.status, 'success', `${label} reverted`);
  txs.push({ label, hash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() });
  console.log(`CONFIRMED ${label} block ${receipt.blockNumber}`);
  return hash;
}
async function trade(account, amountIn, direction, strategyId) {
  const path = strategyId ? `/autopilot/${strategyId}/prepare` : '/wallet/prepare';
  const body = { address: account.address, amountIn, direction };
  let prepared = await request(path, body);
  if (prepared.action === 'approve') {
    await send(account, prepared, `${account === human ? 'human' : 'bot'} token approval`);
    prepared = await request(path, body);
  }
  assert.equal(prepared.action, 'swap');
  const hash = await send(account, prepared, `${strategyId ? 'strategy' : account === human ? 'human' : 'bot'} ${direction}`);
  const result = await request('/wallet/confirm', { ...body, transactionHash: hash });
  assert.equal(result.amountIn, amountIn);
  assert.equal(result.humanBacked, account === human);
  assert.equal(result.tier, account === human ? 'tight' : 'wide');
  if (strategyId) return request(`/autopilot/${strategyId}/confirm`, { transactionHash: hash });
  return result;
}
if (!strategyOnly) {
  for (const account of [human, bot]) {
    await trade(account, '100000000000000', 'tETH-to-tUSD');
    await trade(account, '200000000000000000', 'tUSD-to-tETH');
  }
  const faucet = await request(`/faucet?address=${bot.address}`);
  if (faucet.claimable) {
    await send(bot, await request('/faucet/prepare', { address: bot.address }), 'faucet claim');
    assert.equal((await request(`/faucet?address=${bot.address}`)).claimable, false);
  } else console.log('FAUCET cooldown/inventory guard', faucet.reason);

  const shareBalance = () => client.readContract({ address: deployment.activeVault, abi: tokenAbi, functionName: 'balanceOf', args: [human.address] });
  const before = await shareBalance();
  const liquidityPath = `/vaults/${deployment.activeVault}/liquidity/prepare`;
  const depositBody = { address: human.address, action: 'deposit', maxAmount0: '100000000000000', maxAmount1: '400000000000000000' };
  for (let attempt = 0; attempt < 4; attempt++) {
    const prepared = await request(liquidityPath, depositBody);
    await send(human, prepared, `liquidity ${prepared.action}`);
    if (prepared.action === 'deposit') break;
  }
  const deposited = (await shareBalance()) - before;
  assert.ok(deposited > 0n, 'Deposit did not mint LP shares');
  await send(human, await request(liquidityPath, { address: human.address, action: 'redeem', shares: deposited.toString() }), 'liquidity redeem');
  assert.equal(await shareBalance(), before, 'LP shares did not return to initial balance');
}
let plan = await request('/autopilot/plan', {
  prompt: 'Convert 0.4 tUSD to tETH in 2 slices when bot activity is below 95% and fee is under 35 bps and dispersion is below 300 bps.',
  owner: human.address, totalAmount: '400000000000000000', slices: 2,
  maxBotShareBps: 9500, maxFeeBps: 35, maxPriceGapBps: 300,
});
console.log('STRATEGY', plan.id);
plan = await request(`/autopilot/${plan.id}/activate`, {});
assert.equal(plan.decision, 'execute', plan.decisionSummary);
for (let slice = 0; slice < 2; slice++) {
  plan = await trade(human, plan.sliceAmount, plan.direction, plan.id);
  assert.equal(plan.executedSlices, slice + 1);
}
assert.equal(plan.status, 'completed');
assert.equal(plan.remainingAmount, '0');
const replay = await request(`/autopilot/${plan.id}/confirm`, { transactionHash: plan.executions[0].transactionHash });
assert.equal(replay.executedSlices, 2);
assert.equal((await request(`/autopilot/${plan.id}`)).status, 'completed');
console.log('PASS', JSON.stringify({ strategyId: plan.id, status: plan.status, transactions: txs }, null, 2));
