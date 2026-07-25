import { useCallback, useEffect, useState } from 'react';

import type { DemoQuotes, DemoTradeDirection, ProtocolState } from '../types';

interface ProtocolSnapshot {
  state: ProtocolState;
  quotes: DemoQuotes;
}

export const demoTradeAmountIn = '100000000000000000';
export const demoTradeAmounts: Record<DemoTradeDirection, string[]> = {
  'tETH-to-tUSD': [
    '100000000000000000',
    '500000000000000000',
    '1000000000000000000',
  ],
  'tUSD-to-tETH': [
    '100000000000000000000',
    '500000000000000000000',
    '1000000000000000000000',
  ],
};

export function apiBase(): string {
  const override = window.location.hash.slice(1);
  return (override || window.location.origin).replace(/\/$/, '');
}

export function useProtocol(
  amountIn = demoTradeAmountIn,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
  pollInterval = 2_500,
) {
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const base = apiBase();
      const [stateResponse, quotesResponse] = await Promise.all([
        fetch(`${base}/state`, { signal }),
        fetch(`${base}/demo/quotes?amountIn=${amountIn}&direction=${direction}`, { signal }),
      ]);

      if (!stateResponse.ok || !quotesResponse.ok) {
        const failed = !stateResponse.ok ? stateResponse : quotesResponse;
        const body = (await failed.json().catch(() => undefined)) as
          | { error?: string; code?: string; retryAfterSeconds?: number }
          | undefined;
        const retry = body?.retryAfterSeconds ? ` Retry in ${body.retryAfterSeconds}s.` : '';
        throw new Error(
          body?.error
            ? `${body.error}${retry}`
            : `API returned state=${stateResponse.status}, quotes=${quotesResponse.status}`,
        );
      }

      const [state, quotes] = (await Promise.all([
        stateResponse.json(),
        quotesResponse.json(),
      ])) as [ProtocolState, DemoQuotes];

      setSnapshot({ state, quotes });
      setError(undefined);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, [amountIn, direction]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), pollInterval);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [pollInterval, refresh]);

  return { snapshot, error, refreshing, refresh };
}
