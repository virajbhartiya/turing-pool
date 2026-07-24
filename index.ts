import { Hono } from 'hono';

import app from './server/src/vercel-app.ts';

export default app satisfies Hono;
