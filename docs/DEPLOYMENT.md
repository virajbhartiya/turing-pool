# World Chain deployment

Turing Pool runs its complete state machine on World Chain, chain ID `480`.
Canonical AgentBook identity, SwapVM opcode 34, Aqua settlement, the
volume-weighted fee controller, LP vaults, test assets, and the faucet share one
transaction domain.

The checked-in production manifest is
`contracts/deployments/world-mainnet.json`.

## Required runtime values

```bash
RPC_URL=https://your-world-chain-rpc
WORLD_RPC_URL=https://your-world-chain-rpc
CHAIN_ID=480
AGENTKIT_SIGNER_CHAIN_ID=480
AGENTKIT_SIGNER_RPC_URL=https://your-world-chain-rpc
DEPLOYMENTS_JSON='{"...":"contents of world-mainnet.json"}'
VAULT_FACTORY=0x83a665206D5cc52A0fDA7f308C5C1967d5159Fd0
FAUCET_ADDRESS=0x8DE77C94983ACDaE8f08d558804068cA24FF4fC6
NUTHATCH_URL=http://turing-pool-indexer:8288
```

`DEPLOYMENTS_JSON` is required in production. The process refuses to start
without it so local contract addresses cannot be published accidentally.

## Services

The production host runs three containers on one private Docker network:

1. `turing-pool-app` serves the Vite build and Hono API.
2. `turing-pool-indexer` runs the persistent Nuthatch World Chain nest.
3. `turing-pool-proxy` terminates HTTPS and forwards the public origin.

The app and indexer should use a dedicated World Chain RPC. The checked-in
public endpoint is a fallback and can be rate limited.

## Release sequence

1. Confirm `world-mainnet.json` points to the canonical AgentBook, live Aqua,
   active routers, factory, vault, quota, tokens, and faucet.
2. Build the application image from the intended Git commit.
3. Start Nuthatch with `nuthatch/nuthatch.toml` and wait for `/ready`.
4. Start the app with the exact manifest injected as `DEPLOYMENTS_JSON`.
5. Verify `/health`, `/state`, `/market/quotes`, `/vaults`, and `/faucet`.
6. Check a World ID-verified wallet and an unregistered wallet through
   `/identity/status`.
7. Execute one connected-wallet swap and confirm `HumanGated`, `Swapped`,
   the Aqua balance movement, the next fee schedule, and Nuthatch ingestion.
8. Deposit and redeem a small two-sided LP position and confirm the resulting
   `tpWORLDLP` balance and Aqua dock/ship lifecycle.

## Container check

```bash
docker build -t turing-pool .
docker run --rm -p 4021:4021 \
  -e RPC_URL=https://your-world-chain-rpc \
  -e WORLD_RPC_URL=https://your-world-chain-rpc \
  -e CHAIN_ID=480 \
  -e AGENTKIT_SIGNER_CHAIN_ID=480 \
  -e DEPLOYMENTS_JSON="$(cat contracts/deployments/world-mainnet.json)" \
  -e VAULT_FACTORY=0x83a665206D5cc52A0fDA7f308C5C1967d5159Fd0 \
  -e FAUCET_ADDRESS=0x8DE77C94983ACDaE8f08d558804068cA24FF4fC6 \
  turing-pool
```

The container is healthy when `GET /health` succeeds. The dashboard and API
share an origin.
