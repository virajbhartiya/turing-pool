# Deployment

## World identity + Base Sepolia execution

The current live demo keeps the canonical AgentBook on World Chain and deploys
the AgentBook mirror, Aqua, SwapVM, quotas, assets, and vaults on Base Sepolia.
See [BASE_MIRROR.md](./BASE_MIRROR.md) for the trust boundary and relay flow.

| Contract | Address |
|---|---|
| World AgentBook (chain 480) | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| Base AgentBook mirror | `0x70b9FE7Bd162B0014df1E1f435dB47765Db62455` |
| Base Aqua | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Base primary SwapVM router | `0xc8c614C5Ef7823F4E0E6baf3EbC4593d089c7F22` |
| Base guarded HumanQuota | `0xEE987052Ac1840AAd96eF322822C664616c15C66` |
| Base vault router | `0x503A9d46Da9A9b1d7EDf798F4cef2E49f296e0CE` |
| Base vault factory | `0x9DbA0d4a5504CFB8d0dbac33E6b0BCe2a9Dfa313` |
| Seeded LP vault | `0x642c3e986EA0bc8e1D2012732Ef1F0B0A0C38209` |

Run the server:

```bash
RPC_URL=https://base-sepolia-rpc.publicnode.com \
CHAIN_ID=84532 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/base-sepolia-mirrored.json" \
VAULT_FACTORY=0x9DbA0d4a5504CFB8d0dbac33E6b0BCe2a9Dfa313 \
NUTHATCH_URL=http://127.0.0.1:8288 \
pnpm --filter @turing-pool/server start
```

## Previous World Chain deployment

The executable protocol is deployed on World Chain (chain `480`). Identity
resolution uses the canonical World AgentBook; `mockAgentBook` is false in the
checked-in deployment manifest.

| Contract | Address |
|---|---|
| Aqua | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Canonical AgentBook | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| TuringPoolApp | `0xA4CECe31cA7A7fb79f4A0ffCfd219d1BF92fD46b` |
| Adaptive TuringPoolRouter | `0x237726Cdf497794357D4BcB0bCDBD04437F0eAa3` |
| HumanQuota + volume controller | `0x23253c0e2aF22D83859F9f0B61b2ed45ED3Bd63B` |
| HumanGate v2 vault router | `0x4f09A6EbB5772D4c4BDf90F717AB0C7ee4bb908f` |
| Permissionless vault factory | `0xA07f3f966568bd8dFD503B616c68f39D2e2d3a8B` |

Run the server against the live deployment:

```bash
RPC_URL=https://worldchain-mainnet.g.alchemy.com/public \
CHAIN_ID=480 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/world-mainnet.json" \
pnpm --filter @turing-pool/server start
```

Use an archive-capable RPC: the dashboard reconstructs its feed from contract
events beginning at the checked-in deployment block.

For the complete three-system demo, run the checked-in Nuthatch nest alongside
the API:

```bash
pnpm nuthatch:dev
NUTHATCH_URL=http://127.0.0.1:8288 pnpm --filter @turing-pool/server start
```

Nuthatch is a persistent indexer and should not run inside a Vercel Function.
For a hosted demo, deploy it as a small stateful sidecar and point the API's
`NUTHATCH_URL` at that private/gateway-protected endpoint.

## Vercel production

The Vercel project serves:

- `web/` is the Vite + React trading terminal; Vercel builds it into `public/`.
- `index.ts` is the Hono Function entrypoint.
- `/health`, `/state`, `/demo/quotes`, `/quote`, and `POST /demo/trade` are
  backend routes.
- `/vaults` and its prepare routes expose the optional permissionless LP
  factory to connected wallets without moving signing keys into the server.
- The production runtime reads Base Sepolia and can execute capped demo trades.

```bash
vercel link --project turing-pool
vercel deploy . -y
```

Use `pnpm demo:sepolia` to execute and assert both lanes through the same HTTP
route as the browser.

## Live-chain production

Turing Pool runs as an application container plus a stateful Nuthatch sidecar.
The Hono API serves the dashboard at `/`, JSON endpoints under their existing
paths, and a process-only health check at `/health`. Nuthatch is required for
new autonomous policy decisions. SwapVM quotes and settlement use the last
accepted on-chain policy if the indexer is unavailable.

## Required production inputs

- `RPC_URL`: a Base Sepolia RPC endpoint.
- `DEPLOYMENTS_JSON`: the complete JSON emitted by
  `contracts/script/DeployDemo.s.sol`.
- `CHAIN_ID=84532`.
- `DEMO_TRADES_ENABLED=1`, `DEMO_TRADE_ORIGIN`, and
  `DEMO_TRADE_MAX_AMOUNT_IN=1000000000000000000`.
- `BOT_PRIVATE_KEY` and `HUMAN_AGENT_PRIVATE_KEY`: disposable, minimally funded
  demo actors. Never expose these to Vite or commit them.
- `NUTHATCH_URL`: stateful Nuthatch HTTP endpoint. The production dashboard
  exposes index lag and risk-window provenance; the strategist refuses to
  reprice without it.
- `VAULT_FACTORY`: optional verified `TuringPoolVaultFactory` address. It
  enables pool creation, LP deposits/withdrawals, and selected-vault trades.
  The factory's `ROUTER()` must be the deployed HumanGate v2 SwapVM router and
  each vault is checked against `isVault` before calldata is prepared.
- `FAUCET_ADDRESS`: optional verified `TuringPoolFaucet` address. The faucet
  distributes only pre-funded test-token inventory and enforces its claim
  amount and cooldown on-chain.

## Container verification

```bash
docker build -t turing-pool .
docker run --rm -p 4021:4021 \
  -e RPC_URL=https://base-sepolia-rpc.publicnode.com \
  -e CHAIN_ID=84532 \
  -e DEPLOYMENTS_JSON="$(cat contracts/deployments/base-sepolia-mirrored.json)" \
  turing-pool
```

The container reports healthy when `GET /health` succeeds. The dashboard and
API share an origin, so no production API URL rewrite is necessary.

## Render

The repository includes `render.yaml`. Create a Blueprint from the private
repository and supply the three secret values when prompted. Automatic deploys
wait for GitHub checks to pass.

Render provides `RENDER_EXTERNAL_HOSTNAME`; the server derives the AgentKit
SIWE domain and HTTPS resource URL from it. For another host, set
`SERVER_DOMAIN` and `BASE_URL` explicitly.

## Release order

1. Synchronize canonical World AgentBook records into the authenticated Base
   mirror and verify their source block/hash.
2. Deploy the Base execution contracts against the mirror.
3. Save the emitted deployment file and provide it as
   `DEPLOYMENTS_JSON`.
4. Configure the Base RPC, capped trade route, and disposable server keys.
5. Deploy and verify the HumanGate v2 router/factory, then set
   `VAULT_FACTORY`; never configure a local or fork-only address in production.
6. Start Nuthatch and verify its `/ready`, mirror table, and `turing_trades`.
7. Verify `/health`, `/state`, `/demo/quotes`, `POST /demo/trade`, `/vaults`,
   and the dashboard.
