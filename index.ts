import { Hono } from 'hono';

const { default: app } = process.env.DEPLOYMENTS_JSON
  ? await import('./server/src/app.js')
  : await import('./server/src/vercel-app.js');

export default app satisfies Hono;
