import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const functionEntry = resolve('.vercel/output/functions/index.func/index.js');
const dashboardEntry = resolve('.vercel/output/static/index.html');
const routeManifest = resolve('.vercel/output/config.json');
const execFileAsync = promisify(execFile);

test('the Vercel route manifest sends dashboard API paths to the Hono function', async () => {
  const config = JSON.parse(await readFile(routeManifest, 'utf8'));
  const static404Index = config.routes.findIndex((route) => route.status === 404);
  const functionRoutes = config.routes
    .map((route, index) => ({ ...route, index }))
    .filter((route) => route.dest === '/' && route.src && route.index < static404Index);

  for (const path of ['/health', '/state', '/demo/quotes', '/demo/trade', '/quote']) {
    assert.ok(
      functionRoutes.some((route) => new RegExp(route.src).test(path)),
      `${path} must reach the Hono function before the static 404 route`,
    );
  }
});

test('the Vercel route manifest serves the dashboard at the production root', async () => {
  const config = JSON.parse(await readFile(routeManifest, 'utf8'));
  const static404Index = config.routes.findIndex((route) => route.status === 404);
  const rootRoute = config.routes
    .slice(0, static404Index)
    .find(
      (route) =>
        route.dest === '/index.html' &&
        typeof route.src === 'string' &&
        new RegExp(route.src).test('/'),
    );

  assert.ok(
    rootRoute,
    'GET / must resolve to the built index.html before Vercel reaches its static 404 route',
  );
});

test('the built Vercel output initializes and serves every hosted route', async () => {
  await Promise.all([access(functionEntry), access(dashboardEntry)]);

  const builtModule = await import(
    `${pathToFileURL(functionEntry).href}?test=${Date.now()}`
  );
  const handler = builtModule.default;

  assert.equal(typeof handler?.fetch, 'function');
  const request = (path) =>
    handler.fetch(new Request(`https://turing-pool.test${path}`));
  const [dashboard, health, state, quotes, anonymous, challenge, invalid] =
    await Promise.all([
      request('/'),
      request('/health'),
      request('/state'),
      request('/demo/quotes'),
      request('/quote?anonymous=1'),
      request('/quote'),
      request('/quote?anonymous=1&amountIn=invalid'),
    ]);

  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.get('location'), '/index.html');
  assert.equal(health.status, 200);
  assert.equal(state.status, 200);
  assert.equal(quotes.status, 200);
  assert.equal(anonymous.status, 200);
  assert.equal(challenge.status, 402);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'turing-pool',
    mode: 'hosted-preview-snapshot',
  });
  assert.match(await readFile(dashboardEntry, 'utf8'), /Turing Pool/);
});

test('the built function packages the live-chain backend and its AgentKit dependencies', async () => {
  const deployments = await readFile(
    resolve('contracts/deployments/world-mainnet.json'),
    'utf8',
  );
  const script = `
    const app = (await import(${JSON.stringify(pathToFileURL(functionEntry).href)})).default;
    const response = await app.fetch(new Request('https://turing-pool.test/health'));
    const body = await response.json();
    if (response.status !== 200 || body.mode !== 'live-chain') {
      throw new Error(JSON.stringify({ status: response.status, body }));
    }
  `;

  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      DEPLOYMENTS_JSON: deployments,
      NODE_ENV: 'production',
      RPC_URL: 'http://127.0.0.1:1',
      CHAIN_ID: '480',
    },
  });
});

test('the built Vercel function serves live World Chain state and quotes', async () => {
  const deployments = await readFile(
    resolve('contracts/deployments/world-mainnet.json'),
    'utf8',
  );
  const script = `
    const app = (await import(${JSON.stringify(pathToFileURL(functionEntry).href)})).default;
    const request = (path) => app.fetch(new Request('https://turing-pool.test' + path));
    const [state, quotes] = await Promise.all([
      request('/state'),
      request('/demo/quotes?amountIn=100000000000000000'),
    ]);
    if (state.status !== 200 || quotes.status !== 200) {
      throw new Error(JSON.stringify({
        state: { status: state.status, body: await state.text() },
        quotes: { status: quotes.status, body: await quotes.text() },
      }));
    }
    const [stateBody, quoteBody] = await Promise.all([state.json(), quotes.json()]);
    if (
      stateBody.runtime?.chainId !== 480 ||
      stateBody.feeController?.source !== 'on-chain-volume-controller' ||
      quoteBody.human?.tier !== 'tight' ||
      quoteBody.bot?.tier !== 'wide'
    ) {
      throw new Error(JSON.stringify({ stateBody, quoteBody }));
    }
  `;

  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 30_000,
    env: {
      ...process.env,
      DEPLOYMENTS_JSON: deployments,
      NODE_ENV: 'production',
      RPC_URL: 'https://worldchain-mainnet.g.alchemy.com/public',
      CHAIN_ID: '480',
    },
  });
});
