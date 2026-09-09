import {LRUCache} from "lru-cache";

const MIN_SIZE = 1;

const sizeOf = (value: unknown): number => {
  try {
    if (value === null || value === undefined) return MIN_SIZE;
    if (typeof value === "string") {
      return Math.max(MIN_SIZE, Buffer.byteLength(value));
    }
    if (typeof value === "number" || typeof value === "boolean") return 8;
    if (Buffer.isBuffer(value)) return Math.max(MIN_SIZE, value.length);
    if (value instanceof Map) {
      let size = 0;
      for (const [k, v] of value) size += sizeOf(k) + sizeOf(v);
      return Math.max(MIN_SIZE, size);
    }
    if (value instanceof Set) {
      let size = 0;
      for (const v of value) size += sizeOf(v);
      return Math.max(MIN_SIZE, size);
    }
    if (Array.isArray(value)) {
      let size = 0;
      for (const v of value) size += sizeOf(v);
      return Math.max(MIN_SIZE, size);
    }
    if (typeof value === "object") {
      return Math.max(MIN_SIZE, Buffer.byteLength(JSON.stringify(value)));
    }
    return MIN_SIZE;
  } catch {
    return MIN_SIZE;
  }
};

interface CacheOptions {
  ttlMs?: number;
  max?: number;
  maxSize?: number;
  updateAgeOnGet?: boolean;
}

interface Cache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  del(key: string): void;
  clear(): void;
  size(): number;
  calculatedSize(): number;
}

export const createCache = ({
  ttlMs,
  max = 5000,
  maxSize,
  updateAgeOnGet = true,
}: CacheOptions = {}): Cache => {
  const options: {
    max: number;
    ttl?: number;
    updateAgeOnGet: boolean;
    allowStale: boolean;
    maxSize?: number;
    sizeCalculation?: (value: unknown, key: string) => number;
  } = {
    max,
    updateAgeOnGet,
    allowStale: false,
  };
  if (ttlMs !== undefined) options.ttl = ttlMs;
  if (maxSize !== undefined) {
    options.maxSize = maxSize;
    options.sizeCalculation = (value) => sizeOf(value);
  }
  const cache = new LRUCache<string, any>(options);
  return {
    get: (key) => cache.get(key),
    set: (key, value) => {
      cache.set(key, value);
    },
    has: (key) => cache.has(key),
    del: (key) => {
      cache.delete(key);
    },
    clear: () => cache.clear(),
    size: () => cache.size,
    calculatedSize: () => (cache as any).calculatedSize ?? 0,
  };
};

export const parseTtl = (
  envValue: string | undefined,
  fallbackMs: number,
): number => {
  if (envValue === undefined) return fallbackMs;
  const parsed = parseInt(envValue, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallbackMs : parsed;
};

export {sizeOf};
