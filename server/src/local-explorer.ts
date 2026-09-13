import type { Hono } from 'hono';
import { TransactionReceiptNotFoundError, type Hex } from 'viem';

interface LocalExplorerClient {
  getChainId(): Promise<number>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    transactionHash: string;
    status: string;
    blockNumber: bigint;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    from: string;
    to: string | null;
  }>;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Turing</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f5ee;color:#183b31;font:16px/1.6 system-ui,sans-serif}main{max-width:800px;margin:7vh auto;padding:24px}a{color:inherit;text-underline-offset:5px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:48px}.brand{font-size:24px;font-weight:750;letter-spacing:-1px;text-decoration:none}.badge{font-size:12px;letter-spacing:.1em;text-transform:uppercase;border:1px solid #b9c7bb;border-radius:30px;padding:5px 12px}h1{font-size:clamp(32px,6vw,48px);line-height:1.15;letter-spacing:-1.5px;margin:16px 0}p{color:#576b61}article{margin:32px 0;background:#fffef8;border:1px solid #d9dfd4;border-radius:20px;padding:8px 24px}dl{margin:0}.row{padding:18px 0;border-bottom:1px solid #e4e7de}.row:last-child{border:0}dt{color:#64766c;font-size:13px}dd{margin:5px 0 0;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:14px}.back{display:inline-block;background:#183b31;color:#fffef8;padding:12px 20px;border-radius:10px;text-decoration:none}a:focus-visible{outline:3px solid #8ca681;outline-offset:5px}
  </style></head><body><main><header><a class="brand" href="/#autopilot">Turing</a><span class="badge">Local demo · Chain 31337</span></header><h1>${escapeHtml(title)}</h1>${body}<a class="back" href="/#autopilot">Back to Turing →</a></main></body></html>`;
}

/** A deliberately local receipt viewer; never mounted for public deployments. */
export function mountLocalExplorer(app: Hono, options: {
  chainId: number;
  mockAgentBook: boolean;
  client: LocalExplorerClient;
}): void {
  if (options.chainId !== 31337 || !options.mockAgentBook) return;
  app.get('/demo/transactions/:hash', async (context) => {
    context.header('Cache-Control', 'no-store');
    context.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    const hash = context.req.param('hash');
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return context.html(page('Invalid transaction', '<p>Enter a complete 32-byte transaction hash.</p>'), 400);
    }
    try {
      if (await options.client.getChainId() !== 31337) {
        return context.html(page('Local chain unavailable', '<p>The RPC is not connected to the local demo chain.</p>'), 503);
      }
      const receipt = await options.client.getTransactionReceipt({ hash: hash as Hex });
      const fields = [
        ['Status', receipt.status === 'success' ? 'Confirmed' : 'Reverted'],
        ['Transaction hash', receipt.transactionHash],
        ['Block', receipt.blockNumber],
        ['From', receipt.from],
        ['To', receipt.to ?? 'Contract creation'],
        ['Gas used', receipt.gasUsed],
        ['Gas price (wei)', receipt.effectiveGasPrice],
        ['Transaction fee (wei)', receipt.gasUsed * receipt.effectiveGasPrice],
      ];
      return context.html(page('Transaction receipt', '<p>Mined on the local demo chain. These transactions use demo funds.</p><article><dl>' + fields.map(([label, value]) => `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('') + '</dl></article>'));
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) {
        return context.html(page('Receipt not found', '<p>This transaction has not been mined on the current local chain. It may be pending or from an earlier demo session.</p>'), 404);
      }
      return context.html(page('Local chain unavailable', '<p>The receipt provider is temporarily unavailable. Please try again.</p>'), 503);
    }
  });
}
