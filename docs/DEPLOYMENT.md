# Deployment

Turing Pool deploys as one container: the Hono API serves the dashboard at
`/`, JSON endpoints under their existing paths, and a process-only health
check at `/health`.

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
