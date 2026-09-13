import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AutopilotWorkspace } from '../src/components/AutopilotWorkspace';
import { buildAutopilotPlan, updateAutopilotPlan, type AutopilotEvidence } from '../../server/src/autopilot';
import type { ProtocolState } from '../src/types';

const marketState = {
  runtime: { chainId: 480 },
  pool: { token0: '0x0000000000000000000000000000000000000001', token1: '0x0000000000000000000000000000000000000002', balance0: '1000000000000000000', balance1: '2000000000000000000000' },
  feeController: { tightFeeBps: 23, wideFeeBps: 51 },
  swaps: [], feeHistory: [],
} as unknown as ProtocolState;

test('generate, activate and blocked re-evaluation visibly explain the result without executing', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:4030/#autopilot' });
  const originalFetch = globalThis.fetch;
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const evidence: AutopilotEvidence = {
    source: 'nuthatch', indexedBlock: '34693049', observedAt: new Date().toISOString(),
    fills: 43, tightShareBps: 5359, botShareBps: 4641, currentTightFeeBps: 23,
    currentWideFeeBps: 51, averageExecutionPrice: 2407, priceGapBps: 208.5,
    lagBlocks: 0, available: true, provenance: 'hot+sealed · verified registry',
  };
  let plan = buildAutopilotPlan({ prompt: 'Convert 500 tUSD to tETH in 5 slices when bot activity is below 65% and fee is under 35 bps.',
    owner: '0x1111111111111111111111111111111111111111' }, evidence);
  let executeCalls = 0;
  let failEvaluation = false;
  let releaseEvaluation: (() => void) | undefined;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/autopilot/plan') {
      const body = JSON.parse(String(init?.body));
      plan = buildAutopilotPlan(body, evidence);
    } else if (path.endsWith('/activate')) {
      plan = updateAutopilotPlan(plan, evidence, 'active');
    } else if (path.endsWith('/evaluate')) {
      if (failEvaluation) return Response.json({ error: 'Live evidence unavailable; please retry' }, { status: 503 });
      await new Promise<void>((resolve) => { releaseEvaluation = resolve; });
      plan = updateAutopilotPlan(plan, { ...evidence, observedAt: new Date().toISOString() });
    }
    return Response.json(plan);
  }) as typeof fetch;
  const rootElement = dom.window.document.getElementById('root')!;
  const root = createRoot(rootElement);
  const button = (name: RegExp) => {
    const found = [...rootElement.querySelectorAll('button')].find((element) => name.test(element.textContent ?? ''));
    assert.ok(found, `Expected button ${name}`);
    return found;
  };
  const click = async (element: Element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  try {
    await act(async () => root.render(createElement(AutopilotWorkspace, {
      state: marketState,
      account: '0x1111111111111111111111111111111111111111', walletConnecting: false,
      onConnectWallet: async () => {}, onOpenVerify: () => {},
      onExecute: async () => { executeCalls++; }, onNavigate: () => {}, tradeProgress: [],
    })));
    await click(button(/Generate(?: verified)? strategy/i));
    await click(button(/Activate autopilot/i));
    const result = rootElement.querySelector('.autopilot-position [role="status"]');
    assert.ok(result, 'A strategy result must appear next to the execution button, not only below the fold');
    assert.match(result.textContent ?? '', /208\.5/);
    assert.match(result.textContent ?? '', /150/);
    assert.match(result.textContent ?? '', /no (?:trade|transaction)|not (?:executed|submitted)|blocked|waiting/i);
    await click(button(/Re-evaluate live conditions/i));
    const busy = button(/Checking live conditions/i);
    assert.equal(busy.disabled, true);
    assert.ok(releaseEvaluation);
    await act(async () => { releaseEvaluation!(); });
    assert.match(rootElement.querySelector('.autopilot-position [role="status"]')?.textContent ?? '', /208\.5/);
    assert.equal(executeCalls, 0, 'Re-evaluation must never bypass a failed risk check');
    assert.match(rootElement.querySelector('.autopilot-position [role="status"]')?.textContent ?? '', /checked|check #/i);
    failEvaluation = true;
    await click(button(/Re-evaluate live conditions/i));
    assert.match(rootElement.querySelector('.autopilot-position [role="alert"]')?.textContent ?? '', /Live evidence unavailable/);
    assert.equal(button(/Re-evaluate live conditions/i).disabled, false);
    assert.equal(executeCalls, 0);
    failEvaluation = false;
    evidence.priceGapBps = 80;
    await click(button(/Re-evaluate live conditions/i));
    await act(async () => { releaseEvaluation!(); });
    assert.equal(executeCalls, 0, 'Clearing checks must not execute within the re-evaluate click');
    await click(button(/Execute slice 1/i));
    assert.equal(executeCalls, 1, 'Only a separate explicit execution click opens the wallet');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});

test('initial request failure shows a nearby retry instead of an endless compiling spinner', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:4030/#autopilot' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ error: 'Indexer temporarily unavailable' }, { status: 503 }); }) as typeof fetch;
  const element = dom.window.document.getElementById('root')!;
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(AutopilotWorkspace, { state: marketState,
      walletConnecting: false, onConnectWallet: async () => {}, onOpenVerify: () => {}, onExecute: async () => {}, onNavigate: () => {}, tradeProgress: [] })));
    assert.equal(element.querySelector('.autopilot-loading'), null);
    assert.match(element.querySelector('.autopilot-position [role="alert"]')?.textContent ?? '', /Indexer temporarily unavailable/);
    const retry = [...element.querySelectorAll('button')].find((button) => /Retry loading strategy/i.test(button.textContent ?? ''));
    assert.ok(retry);
    await act(async () => { retry.click(); });
    assert.equal(calls, 2);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    dom.window.close();
  }
});

test('a stalled request times out, reports no transaction and enables a retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:4030/#autopilot' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })) as typeof fetch;
  const savedKey = 'turing:v1:strategy:480:disconnected';
  dom.window.localStorage.setItem(savedKey, 'saved-strategy');
  const element = dom.window.document.getElementById('root')!;
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(AutopilotWorkspace, { state: marketState,
      walletConnecting: false, onConnectWallet: async () => {}, onOpenVerify: () => {}, onExecute: async () => {}, onNavigate: () => {}, tradeProgress: [] })));
    await act(async () => context.mock.timers.tick(15_000));
    assert.match(element.querySelector('.autopilot-position [role="alert"]')?.textContent ?? '', /timed out/i);
    assert.equal(element.querySelector('.autopilot-loading'), null);
    const retry = [...element.querySelectorAll('button')].find((button) => /Retry loading strategy/i.test(button.textContent ?? ''));
    assert.ok(retry);
    assert.equal(retry.disabled, false);
    assert.equal(dom.window.localStorage.getItem(savedKey), 'saved-strategy', 'An indexer outage must not discard the saved plan');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    context.mock.timers.reset();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    dom.window.close();
  }
});
