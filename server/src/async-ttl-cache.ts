export interface AsyncTtlCache<Key, Value> {
  clear(): void;
  delete(key: Key): boolean;
  get(key: Key): Promise<Value>;
}

export interface AsyncTtlCacheOptions<Key, Value> {
  load: (key: Key) => Promise<Value> | Value;
  ttlMs: number;
}

interface CacheEntry<Value> {
  expiresAt?: number;
  promise: Promise<Value>;
}

export function createAsyncTtlCache<Key, Value>({
  load,
  ttlMs,
}: AsyncTtlCacheOptions<Key, Value>): AsyncTtlCache<Key, Value> {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error('Async TTL cache duration must be a non-negative finite number');
  }

  const entries = new Map<Key, CacheEntry<Value>>();

  return {
    clear() {
      entries.clear();
    },

    delete(key) {
      return entries.delete(key);
    },

    get(key) {
      const now = Date.now();
      const cached = entries.get(key);
      if (cached) {
        if (cached.expiresAt === undefined || cached.expiresAt > now) {
          return cached.promise;
        }
        entries.delete(key);
      }

      let promise: Promise<Value>;
      try {
        promise = Promise.resolve(load(key));
      } catch (error) {
        return Promise.reject(error);
      }

      const entry: CacheEntry<Value> = { promise };
      entries.set(key, entry);

      void promise.then(
        () => {
          if (entries.get(key) === entry) {
            entry.expiresAt = Date.now() + ttlMs;
          }
        },
        () => {
          if (entries.get(key) === entry) {
            entries.delete(key);
          }
        },
      );

      return promise;
    },
  };
}
