import { useCallback, useEffect, useState } from 'react';

import type { DemoQuotes, ProtocolState } from '../types';

interface ProtocolSnapshot {
  state: ProtocolState;
  quotes: DemoQuotes;
}

export const demoTradeAmountIn = '100000000000000000';

export function apiBase(): string {
  const override = window.location.hash.slice(1);
  return (override || window.location.origin).replace(/\/$/, '');
}

export function useProtocol(amountIn = demoTradeAmountIn, pollInterval = 2_500) {
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const base = apiBase();
      const [stateResponse, quotesResponse] = await Promise.all([
        fetch(`${base}/state`, { signal }),
        fetch(`${base}/demo/quotes?amountIn=${amountIn}`, { signal }),
      ]);

      if (!stateResponse.ok || !quotesResponse.ok) {
        throw new Error(`API returned state=${stateResponse.status}, quotes=${quotesResponse.status}`);
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
  }, [amountIn]);

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
