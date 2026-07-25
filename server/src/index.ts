import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';

import app from './app.js';
import { PORT } from './config.js';
import { deployments } from './chain.js';

const webRoot = process.env.WEB_ROOT ?? resolve(import.meta.dirname, '../../public');
app.use('/assets/*', serveStatic({ root: webRoot }));
app.use('/brand/*', serveStatic({ root: webRoot }));
app.get('/', serveStatic({ path: resolve(webRoot, 'index.html') }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[turing-pool] quote API on http://localhost:${info.port}`);
  console.log(`[turing-pool] app=${deployments.app} agentBook=${deployments.agentBook}`);
});

function shutdown(signal: string) {
  console.log(`[turing-pool] ${signal} received; closing server`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
