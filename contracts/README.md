# Turing Pool contracts

This package contains the on-chain half of Turing Pool:

- `TuringPoolApp.sol` — an Aqua constant-product app with tight and wide fee tiers.
- `HumanQuota.sol` — daily token-denominated quotas keyed by World AgentBook `humanId`.
- `swapvm/HumanGate.sol` — the custom SwapVM instruction that resolves identity, checks quota, applies the fee tier, and records tight-tier usage.
- `swapvm/TuringPoolRouter.sol` — the standard Aqua opcode table plus `_humanGate` at opcode 34.

## Verify

```bash
forge build
forge test
RUN_FORK_TESTS=1 forge test --match-contract Fork -vv
forge fmt --check
```

Fork tests use the deployed Base contracts:

- 1inch Aqua: `0x499943E74FB0cE105688beeE8Ef2ABec5D936d31`
- World AgentBook: `0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4`

## Deploy the demo

From the repository root, prefer `pnpm demo` for a local stack or
`pnpm demo:fork` for real Aqua and AgentBook bytecode on a Base fork.

To deploy only the contracts:

```bash
anvil --port 8545
forge script script/DeployDemo.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

The script writes the active addresses and strategy data to
`deployments/demo.json` for the API, agents, and dashboard.
