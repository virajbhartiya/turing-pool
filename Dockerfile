FROM node:22-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY economics/package.json economics/package.json
COPY server/package.json server/package.json
COPY agent/package.json agent/package.json
COPY web/package.json web/package.json
COPY subgraph/package.json subgraph/package.json
RUN pnpm install --frozen-lockfile --filter @turing-pool/server... --filter @turing-pool/web...

COPY economics economics
COPY server server
COPY web web
RUN pnpm --filter @turing-pool/web build && pnpm --filter @turing-pool/server build

FROM node:22-alpine AS runner

ENV NODE_ENV="production"
ENV PORT="4021"
WORKDIR /app

RUN addgroup --system --gid 1001 turing && \
    adduser --system --uid 1001 --ingroup turing turing

COPY --from=builder --chown=turing:turing /app/node_modules ./node_modules
COPY --from=builder --chown=turing:turing /app/server/node_modules ./server/node_modules
COPY --from=builder --chown=turing:turing /app/server/dist ./server/dist
COPY --from=builder --chown=turing:turing /app/server/package.json ./server/package.json
COPY --from=builder --chown=turing:turing /app/economics ./economics
COPY --from=builder --chown=turing:turing /app/public ./public

USER turing
EXPOSE 4021

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["npm", "--prefix", "server", "run", "start:prod"]
