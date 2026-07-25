# EC2 deployment

The production server runs as three containers on a private Docker network:

- `turing-pool-app` serves the Vite client and Hono API on port 4021.
- `turing-pool-indexer` runs Nuthatch and serves its API internally on port
  8288.
- `turing-pool-proxy` terminates HTTPS with Caddy and exposes ports 80 and 443.

The app container receives its runtime configuration from
`/home/ec2-user/turing-pool.env`. That file is created directly on the host,
must remain mode `0600`, and must never be committed.

## Install Nuthatch

Nuthatch 0.6.1's Linux binary requires a newer glibc than Amazon Linux 2023
provides. Download the verified official release to the host, then run it
inside the Ubuntu container shown below.

```sh
mkdir -p /home/ec2-user/.local/bin /home/ec2-user/nuthatch-release

curl -fsSL \
  -o /home/ec2-user/nuthatch-release/nuthatch.tar.gz \
  https://github.com/nuthatch-indexer/nuthatch/releases/download/v0.6.1/nuthatch-x86_64-unknown-linux-gnu.tar.gz

echo "eb60c7429a0e7576ad09014cdbb13464cee76c35e26ee20a878c256711092ce9  /home/ec2-user/nuthatch-release/nuthatch.tar.gz" |
  sha256sum --check
```

Extract the archive and install its `nuthatch` binary at
`/home/ec2-user/.local/bin/nuthatch`.

## Start or replace the containers

```sh
sudo docker network inspect turing-pool >/dev/null 2>&1 ||
  sudo docker network create turing-pool

sudo docker run -d \
  --name turing-pool-indexer \
  --restart unless-stopped \
  --network turing-pool \
  -v /home/ec2-user/.local/bin/nuthatch:/usr/local/bin/nuthatch:ro \
  -v /home/ec2-user/turing-pool/nuthatch:/data \
  ubuntu:24.04 \
  /usr/local/bin/nuthatch dev \
  --dir /data \
  --listen 0.0.0.0:8288 \
  --rpc "$WORLD_RPC_URL" \
  --seal-direct \
  --concurrency 4 \
  --window 100 \
  --no-admin

sudo docker run -d \
  --name turing-pool-app \
  --restart unless-stopped \
  --network turing-pool \
  --env-file /home/ec2-user/turing-pool.env \
  turing-pool:latest

sudo docker run -d \
  --name turing-pool-proxy \
  --restart unless-stopped \
  --network turing-pool \
  -e PUBLIC_DOMAIN=example.com \
  -p 80:80 \
  -p 443:443 \
  -v /home/ec2-user/turing-pool/deploy/ec2/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v turing-pool-caddy-data:/data \
  -v turing-pool-caddy-config:/config \
  caddy:2-alpine
```

Set `NUTHATCH_URL=http://turing-pool-indexer:8288` in the host runtime
environment. The indexer is reachable only by containers on the private
network.

The 100-block Nuthatch window is intentional. The RPC proxy splits log scans
into the 10-block ranges accepted by the upstream provider. Larger concurrent
windows can exceed Nuthatch's request timeout while the proxy drains those
subrequests.

When changing the indexed chain or contract registry, do not reuse the old
`nuthatch.redb` cursor or sealed `segments/`. Stop the indexer, move both into a
dated backup outside `/home/ec2-user/turing-pool/nuthatch`, and then start the
indexer against an empty store. A valid rebuild must report a nonzero
`last_block`, `last_block <= tip`, and a small `lag_blocks`; the `/ready`
boolean alone is not sufficient during initial catch-up.

Only ports 80, 443, and restricted SSH should be open in the instance security
group. Ports 4021 and 8288 stay private.
