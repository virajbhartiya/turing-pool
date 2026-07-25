/// The searcher/HFT lane: no World ID proof, so execution uses the adaptive risk fee.
import { API_URL, KEYS, executeSwap, fmt, loadDeployments, makeWallet } from './lib.js';

const d = loadDeployments();
const wallet = makeWallet(KEYS.bot);
const amountIn = BigInt(process.env.AMOUNT_IN ?? '1000000000000000000'); // 1 tETH

console.log('=== SEARCHER / HFT FLOW ===');
console.log(`wallet: ${wallet.account.address}`);

// 1. Plain fetch hits the AgentKit paywall...
const challenged = await fetch(`${API_URL}/quote?amountIn=${amountIn}`);
console.log(`plain fetch -> HTTP ${challenged.status} (server asks for World ID verification)`);

// 2. ...this wallet has no World ID proof, so it uses the searcher lane.
const res = await fetch(`${API_URL}/quote?amountIn=${amountIn}&anonymous=1`);
const quote = await res.json();
console.log(`searcher quote: tier=${quote.tier} fee=${quote.feeBps}bps -> ${fmt(quote.amountOut)} tUSD`);

// 3. Swap on-chain at the wide tier.
const { amountOut, txHash } = await executeSwap(wallet, quote, d.tETH, amountIn);
console.log(`swapped ${fmt(amountIn)} tETH -> ${fmt(amountOut)} tUSD (tx ${txHash.slice(0, 14)}...)`);
console.log(JSON.stringify({ role: 'bot', tier: quote.tier, feeBps: quote.feeBps, amountIn: amountIn.toString(), amountOut: amountOut.toString() }));
