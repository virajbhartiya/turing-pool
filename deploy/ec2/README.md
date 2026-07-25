# EC2 deployment

The production server runs as two containers on a private Docker network:

- `turing-pool-app` serves the Vite client and Hono API on port 4021.
- `turing-pool-proxy` terminates HTTPS with Caddy and exposes ports 80 and 443.

The app container receives its runtime configuration from
`/home/ec2-user/turing-pool.env`. That file is created directly on the host,
must remain mode `0600`, and must never be committed.

## Start or replace the containers

```sh
sudo docker network inspect turing-pool >/dev/null 2>&1 ||
  sudo docker network create turing-pool

sudo docker rm -f turing-pool-app turing-pool-proxy 2>/dev/null || true

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

Only ports 80, 443, and restricted SSH should be open in the instance security
group. Ports 4021 and 8288 stay private.
