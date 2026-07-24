# Deployment

## Base Sepolia

The protocol is deployed on the public Base Sepolia testnet (chain `84532`).
This uses test deployments of Aqua and AgentBook so the complete stack and demo
identities can execute without mainnet funds.

| Contract | Address |
|---|---|
| Aqua | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| AgentBook test registry | `0x265f638eb93314AD0e0471E3cC2c97565e75D6E6` |
| TuringPoolApp | `0x623DbF6A5b0714164707E8036a77C56bc300BF97` |
| TuringPoolRouter | `0x26fdc2De197F43F693F47962669E180D6A539fb7` |
| HumanQuota | `0xA4CECe31cA7A7fb79f4A0ffCfd219d1BF92fD46b` |

Run the server against the public testnet:

```bash
RPC_URL=https://base-sepolia.drpc.org \
CHAIN_ID=84532 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/base-sepolia.json" \
pnpm --filter @turing-pool/server start
```

Use an archive-capable RPC: the dashboard reconstructs its feed from contract
events beginning at the checked-in deployment block.

## Vercel judge preview

The repository includes a zero-secret Vercel preview suitable for judging:

- `public/index.html` is the dashboard.
- `index.ts` is the Hono Function entrypoint.
- `/health`, `/state`, `/demo/quotes`, and `/quote?anonymous=1` are live
  backend routes.
- Runtime and data-source labels explicitly identify deterministic snapshot
  data, and snapshot quotes cannot be executed.

```bash
vercel link --project turing-pool
vercel deploy . -y
```

This preview deliberately remains a deterministic, non-executable snapshot so
it requires no hosted RPC credentials and cannot spend demo funds. The
checked-in Base Sepolia deployment is real and executable; use the local
live-chain command above plus `pnpm demo:sepolia` for the transaction proof.

## Live-chain production

After the protocol contracts and subgraph are deployed, Turing Pool runs as one
container: the Hono API serves the dashboard at `/`, JSON endpoints under their
existing paths, and a process-only health check at `/health`.

## Required production inputs

- `RPC_URL`: a Base mainnet RPC endpoint.
- `SUBGRAPH_URL`: the deployed, synced Turing Pool subgraph endpoint.
- `DEPLOYMENTS_JSON`: the complete JSON emitted by
  `contracts/script/DeployDemo.s.sol` after deploying the production
  contracts. Production startup intentionally refuses the checked-in
  local/fork deployment file.
- `CHAIN_ID=8453`.

Never use the Base-fork deployment JSON in production. Aqua and AgentBook are
real on the fork, but the Turing Pool app, quota, router, and demo tokens only
exist inside that fork.

## Container verification

```bash
docker build -t turing-pool .
docker run --rm -p 4021:4021 \
  -e RPC_URL=https://your-base-rpc \
  -e CHAIN_ID=8453 \
  -e SUBGRAPH_URL=https://your-subgraph \
  -e DEPLOYMENTS_JSON="$(cat contracts/deployments/base.json)" \
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

1. Deploy and verify the contracts on Base.
2. Save the emitted deployment file outside git and provide it as
   `DEPLOYMENTS_JSON`.
3. Configure and deploy the subgraph from `subgraph/`.
4. Set `RPC_URL`, `SUBGRAPH_URL`, and `DEPLOYMENTS_JSON`.
5. deploy the container and verify `/health`, `/state`, `/demo/quotes`, and the
   dashboard.
