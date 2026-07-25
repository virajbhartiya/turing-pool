# Turing Pool

**Identity-priced liquidity on World Chain.**

Turing Pool is an Aqua market whose SwapVM program prices two kinds of order
flow differently:

- **World ID-verified retail** receives the tighter executable rate while its
  per-person daily quota remains available.
- **Searcher / HFT flow** remains executable at a wider, activity-priced rate.
- **Liquidity providers** target a 30 bps volume-weighted fee across both lanes.

The fee pair is not fixed. After every mined fill, `HumanQuota` records executed
input notional and solves the next pair around the LP target:

```text
verified volume × verified fee
+ searcher volume × searcher fee
= total volume × 30 bps
```

Wallet count never enters the equation. AgentBook maps linked wallets to the
same pseudonymous `humanId`, so the quota follows the person rather than a
single address.

## One-chain architecture

Identity, execution, liquidity, test assets, faucet, and indexing all operate on
**World Chain (chain 480)**.

```text
Connected wallet
      │
      ├── canonical World AgentBook lookup
      │
      ▼
SwapVM opcode 34 `_humanGate`
      │  selects live fee + enforces per-human quota
      ▼
1inch Aqua virtual balances
      │  settles real token transfers
      ▼
HumanQuota records notional and solves the next fee pair
      │
      ▼
The Graph Nuthatch indexes receipts into SQL + MCP
```

There is no cross-chain identity relay. The custom SwapVM instruction reads the
canonical AgentBook directly in the same World Chain transaction that settles
through Aqua.

## Live contracts

| Component | World Chain address |
|---|---|
| Canonical AgentBook | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| 1inch Aqua | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Adaptive SwapVM router | `0x237726Cdf497794357D4BcB0bCDBD04437F0eAa3` |
| Primary HumanQuota | `0x23253c0e2aF22D83859F9f0B61b2ed45ED3Bd63B` |
| LP-vault SwapVM router | `0x0435F9650b70310e98fAEcADa042b3b4e4937Cad` |
| Vault factory | `0x83a665206D5cc52A0fDA7f308C5C1967d5159Fd0` |
| Active tETH/tUSD vault | `0xfe193d73161053E52B15527c9B508DB1357Ed072` |
| Vault HumanQuota | `0xea15Bd49c4917E456AD563D5531bDCF95b5A5253` |
| tETH | `0x265f638eb93314AD0e0471E3cC2c97565e75D6E6` |
| tUSD | `0xe57ee4b33C9bAa455EF97EC981e6c7bEE8A86887` |
| Test-token faucet | `0x8DE77C94983ACDaE8f08d558804068cA24FF4fC6` |

The active vault is seeded with two-sided inventory and issues transferable
`tpWORLDLP` shares. The on-chain faucet distributes 1 tETH and 4,000 tUSD per
wallet every 24 hours from pre-funded inventory.

## Sponsor integrations

### World

The official AgentKit SDK protects the quote resource with a 402 → SIWE → retry
flow. The verifier resolves the signer in canonical AgentBook. During settlement,
opcode 34 reads that same AgentBook directly and converts the nonzero `humanId`
into a bounded retail lane.

### 1inch Aqua + SwapVM

The router retains the standard Aqua/SwapVM instruction table and appends
`_humanGate` as opcode 34. Vault inventory is shipped into Aqua, trades execute
the custom SwapVM program, and deposits or withdrawals dock and re-ship the
updated strategy atomically.

### The Graph Nuthatch

Nuthatch follows both routers, both quota controllers, Aqua, and the faucet. It
correlates `HumanGated` with `Swapped`, exposes fee-history and activity-mix SQL
views, and serves the same data through MCP. The pricing strategist accepts no
direct-event fallback: it needs fresh Nuthatch provenance before submitting an
on-chain risk-policy update.

## Run locally against the live market

```bash
pnpm install
pnpm --filter @turing-pool/web build
pnpm --filter @turing-pool/server build

RPC_URL=https://worldchain-mainnet.g.alchemy.com/public \
WORLD_RPC_URL=https://worldchain-mainnet.g.alchemy.com/public \
CHAIN_ID=480 \
AGENTKIT_SIGNER_CHAIN_ID=480 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/world-mainnet.json" \
VAULT_FACTORY=0x83a665206D5cc52A0fDA7f308C5C1967d5159Fd0 \
FAUCET_ADDRESS=0x8DE77C94983ACDaE8f08d558804068cA24FF4fC6 \
pnpm --filter @turing-pool/server start
```

Run Nuthatch in a second terminal and add
`NUTHATCH_URL=http://127.0.0.1:8288` to the API environment:

```bash
NUTHATCH_RPC_URL=https://worldchain-mainnet.g.alchemy.com/public \
pnpm nuthatch:dev
```

## Repository map

```text
contracts/  Foundry contracts: opcode 34, quota controller, vaults, factory, faucet
server/     Hono API: AgentKit, quotes, prepared wallet transactions, indexed state
agent/      AgentKit clients and the Nuthatch-backed pricing strategist
nuthatch/   World Chain event schema, SQL views, semantic layer, MCP surface
web/        Vite + React terminal: swap, liquidity, verification, protocol evidence
docs/       deployment and contract documentation
```

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for the production runbook and
the in-product Protocol page for line-level source links.
