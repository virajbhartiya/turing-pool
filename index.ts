import { Hono } from 'hono';

import app from './server/src/vercel-app.js';

export default app satisfies Hono;
