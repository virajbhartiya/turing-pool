# Permissionless LP vaults

The vault layer turns the original single-maker demo into a reusable liquidity
product. Any caller can create a two-token pool. Any LP can then deposit both
assets, receive transferable ERC-20 shares, and redeem a pro-rata claim on the
pool's live inventory.

## Architecture

Each pool has:

- one `TuringPoolVault`, which holds the real tokens and issues LP shares;
- one dedicated `HumanQuota`, which owns that pool's quota, executed-volume,
  and adaptive fee state;
- one active immutable Aqua order, whose maker is the vault; and
- the shared HumanGate v2 `TuringPoolRouter`, which executes opcode 34 and the
  standard SwapVM constant-product instruction.

All vaults use the same router and canonical AgentBook, but they do not share
fee history. HumanGate v2 includes the current `orderHash` when it records a
fill. A vault authorizes only its active order in its own controller and revokes
that authorization when the order is replaced. An unrelated order on the
shared router therefore cannot alter another vault's quota or fee schedule.

## Liquidity lifecycle

The first deposit sets the pool ratio and mints the geometric mean of both
amounts as shares, less permanently locked minimum liquidity. Later deposits
mint shares at the existing reserve ratio; excess tokens remain in the LP's
wallet.

Aqua strategies are immutable. When liquidity changes, the vault performs one
atomic transaction:

1. dock the current Aqua order and revoke its controller authorization;
2. transfer the deposited assets or pay the redemption;
3. build a new opcode-34 SwapVM order with a fresh salt;
4. authorize the new order hash; and
5. ship the vault's complete remaining inventory to Aqua.

A mined swap transfers tokens into and out of the vault, updates the vault's
virtual Aqua balances, records executed notional in its controller, and
reprices the next human/bot fee pair around the configured LP target.

The manager may pause deposits and remove the active Aqua allocation.
Redemptions remain enabled while paused.

## Deploy the shared router and factory

The existing World Chain demo router is HumanGate v1. Vaults require the
order-bound HumanGate v2 router, so the deployment script creates a new shared
router and factory against the existing Aqua and canonical AgentBook:

```bash
cd contracts

PRIVATE_KEY=... \
AQUA=0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec \
AGENT_BOOK=0xA23aB2712eA7BBa896930544C7d6636a96b944dA \
VAULT_FACTORY_FILE=./deployments/world-mainnet-vault-factory.json \
forge script script/DeployVaultFactory.s.sol:DeployVaultFactory \
  --rpc-url "$RPC_URL" \
  --broadcast
```

The output manifest contains the Aqua, router, AgentBook, factory, and chain
addresses. Deployment is intentionally separate from the current demo
manifest; do not point production at the factory until the new addresses have
been verified and funded.

## Create and seed a pool

Call `createVault` on the factory with:

- the two ERC-20 tokens;
- the pool manager;
- LP share name and symbol;
- per-token daily human caps;
- target, desired-human, and maximum-bot fees; and
- optional seed volumes when migrating an existing fee history.

The returned `vault` and `quota` addresses are also emitted in `VaultCreated`.
The checked-in `CreateVault.s.sol` script exposes these values as environment
inputs and writes a pool manifest:

```bash
cd contracts

PRIVATE_KEY=... \
VAULT_FACTORY=0x... \
TOKEN0=0x... \
TOKEN1=0x... \
DAILY_CAP0=10000000000000000000 \
DAILY_CAP1=40000000000000000000000 \
VAULT_FILE=./deployments/my-vault.json \
forge script script/CreateVault.s.sol:CreateVault \
  --rpc-url "$RPC_URL" \
  --broadcast
```

Before depositing, an LP approves the vault—not Aqua—to spend both tokens.
The LP then calls:

```solidity
vault.deposit(maxAmount0, maxAmount1, minShares, receiver);
```

Use `previewDeposit` to calculate the proportional amounts and shares before
submitting. Withdraw with:

```solidity
vault.redeem(shares, minAmount0, minAmount1, receiver);
```

## Trust and production notes

- Pool managers can pause deposits and update their pool's quota and fee
  policy. They cannot block redemptions through the vault pause mechanism.
- LP shares account for the vault's token inventory, not an oracle-priced
  portfolio value. Deposits must contain both tokens at the current pool ratio.
- Fee-on-transfer, rebasing, and callback-bearing tokens have not been
  qualified and should not be listed without additional review.
- The contracts have automated integration coverage but have not been audited.
- The React terminal discovers every vault from the configured factory. A
  connected wallet can create a market, approve and deposit both assets, receive
  transferable LP shares, redeem its pro-rata position, and submit the selected
  vault's live SwapVM trade.
- The API simulates the final create, deposit, redeem, and swap call before
  returning MetaMask calldata. Approvals are returned as explicit preliminary
  actions and are scoped to the selected vault or shared router.
- Set `VAULT_FACTORY` only after verifying the factory and HumanGate v2 router
  on the intended chain. If it is absent, the terminal presents the original
  deployed market and an honest "factory not configured" vault state.
