import {createCache, parseTtl} from "./cache";

const isCacheEnabled = (): boolean => process.env.CACHE_ENABLED !== "false";

const MB = 1024 * 1024;

const DEFAULTS: Record<string, number> = {
  user: 30000,
  vehicleProfile: 30000,
  alleySegment: 120000,
  landmark: 120000,
  routing: 10000,
  flag: 10000,
  shop: 120000,
};

const MAX_SIZES_MB: Record<string, number> = {
  user: 3,
  vehicleProfile: 3,
  alleySegment: 4,
  landmark: 2,
  routing: 8,
  flag: 4,
  shop: 2,
};

const ttlFor = (namespace: string): number =>
  parseTtl(
    process.env[`CACHE_TTL_${namespace.toUpperCase()}_MS`],
    DEFAULTS[namespace] || 30000,
  );

const maxSizeFor = (namespace: string): number =>
  parseTtl(
    process.env[`CACHE_MAX_SIZE_${namespace.toUpperCase()}_MB`],
    MAX_SIZES_MB[namespace] || 1,
  ) * MB;

interface CacheHandle {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  del(key: string): void;
  clear(): void;
  size(): number;
}

const caches: Record<string, CacheHandle> = {};

const ensureCache = (namespace: string): CacheHandle => {
  if (!caches[namespace]) {
    caches[namespace] = createCache({
      ttlMs: ttlFor(namespace),
      maxSize: maxSizeFor(namespace),
    });
  }
  return caches[namespace];
};

export const get = (namespace: string, key: string): unknown => {
  if (!isCacheEnabled()) return undefined;
  return caches[namespace] ? caches[namespace].get(key) : undefined;
};

export const set = (namespace: string, key: string, value: unknown): void => {
  if (!isCacheEnabled()) return;
  ensureCache(namespace).set(key, value);
};

export const del = (namespace: string, key?: string): void => {
  if (!caches[namespace]) return;
  if (key === undefined) caches[namespace].clear();
  else caches[namespace].del(key);
};

type CacheFn<T extends unknown[] = unknown[], R = unknown> = (
  ...args: T
) => Promise<R>;

type WrappedFn<T extends unknown[] = unknown[], R = unknown> =
  CacheFn<T, R> & {
    invalidate: (key: string) => void;
    invalidateAll: () => void;
  };

export const wrap = <T extends unknown[], R>(
  fn: CacheFn<T, R>,
  {
    namespace,
    keyFn = (...args: T) => JSON.stringify(args),
  }: {namespace: string; keyFn?: (...args: T) => string},
): WrappedFn<T, R> => {
  ensureCache(namespace);
  const wrapped = async (...args: T): Promise<R> => {
    const key = keyFn(...args);
    const hit = get(namespace, key);
    if (hit !== undefined) return hit as R;
    const result = await fn(...args);
    if (result !== undefined) set(namespace, key, result);
    return result;
  };
  return Object.assign(wrapped, {
    invalidate: (key: string) => del(namespace, key),
    invalidateAll: () => del(namespace),
  });
};

export {caches, isCacheEnabled};
