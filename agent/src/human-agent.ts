/// The human-backed agent: registered in World's AgentBook, proves it via the
/// official AgentKit 402 -> SIWE -> retry flow, and gets the tight spread.
/// Then its sybil twin (same human, different wallet) shows the cap is per-HUMAN.
import { API_URL, KEYS, executeSwap, fmt, loadDeployments, makeAgentkitFetch, makeWallet } from './lib.js';
import type { QuoteResponse } from './lib.js';

const d = loadDeployments();
const amountIn = BigInt(process.env.AMOUNT_IN ?? '1000000000000000000'); // 1 tETH

async function agentQuote(key: `0x${string}`, amount: bigint): Promise<QuoteResponse> {
  const agentkit = makeAgentkitFetch(key);
  const res = await agentkit.fetch(`${API_URL}/quote?amountIn=${amount}`);
  if (!res.ok) throw new Error(`quote failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as QuoteResponse;
}

console.log('=== HUMAN-BACKED AGENT ===');
const wallet = makeWallet(KEYS.humanAgent);
console.log(`wallet: ${wallet.account.address} (registered in AgentBook ${d.agentBook})`);

const quote = await agentQuote(KEYS.humanAgent, amountIn);
console.log(
  `verified=${quote.identity.verified} humanBacked=${quote.identity.humanBacked} humanId=${quote.identity.humanId?.slice(0, 12)}...`,
);
console.log(`quote: tier=${quote.tier} fee=${quote.feeBps}bps -> ${fmt(quote.amountOut)} tUSD`);
console.log(
  `vs anonymous: ${fmt(quote.wideAmountOut)} tUSD  (price improvement: ${quote.improvementBps} bps, quota left: ${fmt(quote.quotaRemainingTokenIn)} tETH)`,
);

const { amountOut, txHash } = await executeSwap(wallet, quote, d.tETH, amountIn);
console.log(`swapped ${fmt(amountIn)} tETH -> ${fmt(amountOut)} tUSD (tx ${txHash.slice(0, 14)}...)`);

// --- The sybil test: same human, fresh wallet, tries to grab a fresh quota ---
console.log('\n=== SYBIL TWIN (same human, different wallet) ===');
const sybilWallet = makeWallet(KEYS.sybilAgent);
console.log(`wallet: ${sybilWallet.account.address} (also registered, SAME humanId)`);

const bigAmount = BigInt(process.env.SYBIL_AMOUNT_IN ?? '10000000000000000000'); // 10 tETH > remaining cap
const sybilQuote = await agentQuote(KEYS.sybilAgent, bigAmount);
console.log(
  `quote for ${fmt(bigAmount)} tETH: tier=${sybilQuote.tier} fee=${sybilQuote.feeBps}bps (quota left: ${fmt(sybilQuote.quotaRemainingTokenIn)} tETH)`,
);
if (sybilQuote.tier === 'wide') {
  console.log('cap is per-HUMAN, not per-wallet: the fresh wallet inherited the spent quota. Sybil attack defeated.');
}

console.log(
  JSON.stringify({
    role: 'human',
    tier: quote.tier,
    feeBps: quote.feeBps,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    wideAmountOut: quote.wideAmountOut,
    improvementBps: quote.improvementBps,
    sybilTier: sybilQuote.tier,
  }),
);
