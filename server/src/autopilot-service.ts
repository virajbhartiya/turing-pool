import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { updateAutopilotPlan, type AutopilotEvidence, type AutopilotPlan, type AutopilotStatus } from './autopilot.js';
import type { ConnectedWalletPreparation, DemoTradeResult } from './router-demo.js';

interface PreparedSlice {
  slice: number;
  amountIn: string;
  afterBlock: string;
  expiresAt: string;
  verified: boolean;
  maxFeeBps: number;
  transaction: ConnectedWalletPreparation['transaction'];
}
interface StoredStrategy { plan: AutopilotPlan; prepared?: PreparedSlice }
export class AutopilotValidationError extends Error {}

/** Single-process durable ledger. Atomic replacement keeps plan and consumed receipt together.
 * Run one API writer per store; clustered deployments require a transactional database. */
export class AutopilotStore {
  private records = new Map<string, StoredStrategy>();
  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as { version: number; records: StoredStrategy[] };
      if (saved.version !== 1 || !Array.isArray(saved.records)) throw new Error('Unsupported autopilot store format.');
      this.records = new Map(saved.records.map((record) => [record.plan.id, record]));
    }
  }
  get(id: string): StoredStrategy | undefined { return this.records.get(id); }
  receiptOwner(hash: string): string | undefined {
    for (const [id, { plan }] of this.records) {
      if (plan.executions.some((execution) => execution.transactionHash.toLowerCase() === hash.toLowerCase())) return id;
    }
    return undefined;
  }
  set(record: StoredStrategy): void {
    const next = new Map(this.records);
    next.set(record.plan.id, record);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, records: [...next.values()] }), { mode: 0o600 });
      renameSync(temporary, this.path);
    }
    this.records = next;
  }
}

export interface AutopilotDependencies {
  evidence(): Promise<AutopilotEvidence>;
  verifyOwner(owner: string): Promise<boolean>;
  blockNumber(): Promise<bigint>;
  prepare(owner: string, amount: bigint, direction: AutopilotPlan['direction']): Promise<ConnectedWalletPreparation>;
  confirm(owner: string, hash: string, direction: AutopilotPlan['direction']): Promise<DemoTradeResult>;
  transaction(hash: string): Promise<{ from: string; to: string | null; input: string; timestamp: bigint }>;
}

export class AutopilotService {
  // Serializes mutations, including cross-plan receipt consumption. Never hold a stale plan across an await.
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: AutopilotStore, private readonly deps: AutopilotDependencies) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private record(id: string): StoredStrategy {
    const record = this.store.get(id);
    if (!record) throw new AutopilotValidationError('Strategy was not found.');
    return record;
  }
  evaluate(id: string, status?: AutopilotStatus): Promise<AutopilotPlan> {
    return this.exclusive(async () => {
      const record = this.record(id);
      const plan = updateAutopilotPlan(record.plan, await this.deps.evidence(), status);
      this.store.set({ ...record, plan });
      return plan;
    });
  }
  prepare(id: string, address: string): Promise<ConnectedWalletPreparation> {
    return this.exclusive(async () => {
      const record = this.record(id);
      const plan = updateAutopilotPlan(record.plan, await this.deps.evidence());
      if (!plan.owner || plan.owner.toLowerCase() !== address.toLowerCase()) throw new AutopilotValidationError('Only the strategy owner can prepare its transaction.');
      const verified = await this.deps.verifyOwner(plan.owner);
      if (plan.status !== 'active' || plan.decision !== 'execute' || plan.evidence.source === 'snapshot') throw new AutopilotValidationError('Strategy must be active with passing live policy checks.');
      const afterBlock = await this.deps.blockNumber();
      const prepared = await this.deps.prepare(plan.owner, BigInt(plan.sliceAmount), plan.direction);
      // A connected wallet can use the standard lane. Verification unlocks the
      // tighter human-backed quote, while the unverified lane is bounded by the
      // live wide fee observed in the same evidence window.
      const laneMatches = verified
        ? prepared.quote.humanBacked && prepared.quote.tight
        : !prepared.quote.humanBacked && !prepared.quote.tight;
      const laneFeeLimit = verified
        ? plan.conditions.maxFeeBps
        : Math.max(plan.conditions.maxFeeBps, plan.evidence.currentWideFeeBps);
      if (!laneMatches) {
        throw new AutopilotValidationError(verified
          ? 'The current verified wallet quote does not satisfy the strategy policy.'
          : 'The connected wallet is not verified for the tighter execution lane; use the standard quote or verify with World ID.');
      }
      if (prepared.quote.feeBps > laneFeeLimit || prepared.quote.amountIn !== plan.sliceAmount) {
        throw new AutopilotValidationError('The current wallet quote does not satisfy the strategy policy.');
      }
      this.store.set({ plan, prepared: prepared.action === 'swap' ? {
        slice: plan.executedSlices + 1, amountIn: plan.sliceAmount, afterBlock: afterBlock.toString(),
        expiresAt: new Date(Math.min(Date.parse(plan.expiresAt), Date.now() + 5 * 60_000)).toISOString(),
        verified, maxFeeBps: laneFeeLimit,
        transaction: prepared.transaction,
      } : undefined });
      return prepared;
    });
  }
  confirm(id: string, hash: string): Promise<AutopilotPlan> {
    return this.exclusive(async () => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new AutopilotValidationError('A valid transaction hash is required.');
      const { plan, prepared } = this.record(id);
      const consumedBy = this.store.receiptOwner(hash);
      if (consumedBy === id) return plan;
      if (consumedBy) throw new AutopilotValidationError('This transaction was already consumed by another strategy.');
      if (!prepared || !plan.owner) throw new AutopilotValidationError('No prepared strategy swap exists for this receipt.');
      if (prepared.slice !== plan.executedSlices + 1) throw new AutopilotValidationError('Prepared slice is no longer current.');
      const receipt = await this.deps.confirm(plan.owner, hash, plan.direction);
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || receipt.wallet.toLowerCase() !== plan.owner.toLowerCase() ||
        receipt.direction !== plan.direction || receipt.amountIn !== prepared.amountIn ||
        (prepared.verified ? !receipt.humanBacked || !receipt.tight : receipt.humanBacked || receipt.tight) ||
        receipt.feeBps > prepared.maxFeeBps || BigInt(receipt.blockNumber) <= BigInt(prepared.afterBlock)) {
        throw new AutopilotValidationError('On-chain receipt does not match the prepared slice and strategy policy.');
      }
      const transaction = await this.deps.transaction(hash);
      if (transaction.from.toLowerCase() !== prepared.transaction.from.toLowerCase() ||
        transaction.to?.toLowerCase() !== prepared.transaction.to.toLowerCase() ||
        transaction.input.toLowerCase() !== prepared.transaction.data.toLowerCase() ||
        Number(transaction.timestamp) * 1000 > Date.parse(prepared.expiresAt)) {
        throw new AutopilotValidationError('On-chain transaction does not match the prepared request or execution window.');
      }
      // A mined transaction can be reconciled after a pause, expiry, or indexer outage;
      // these must not erase a real fill that met the preparation window.
      let evidence = plan.evidence;
      try { evidence = await this.deps.evidence(); } catch { evidence = { ...evidence, available: false }; }
      const updated = updateAutopilotPlan({ ...plan, executedSlices: plan.executedSlices + 1,
        executions: [...plan.executions, { slice: prepared.slice, amountIn: receipt.amountIn,
          transactionHash: hash, confirmedAt: new Date(Number(transaction.timestamp) * 1000).toISOString() }],
      }, evidence);
      this.store.set({ plan: updated });
      return updated;
    });
  }
}
