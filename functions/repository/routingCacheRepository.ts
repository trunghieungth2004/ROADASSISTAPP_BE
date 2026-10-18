import {db} from "../config/firebase";

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

const ttlSeconds = (): number => {
  const raw = Number(process.env.ROUTING_CACHE_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return raw;
};

interface CachedRoute {
  geometry: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
}

interface RouteCacheEntry {
  id: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops?: {lat: number; lng: number}[];
  widthBucket: string;
  routes?: unknown;
  geometry?: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
  cachedAt: string;
  expiresAt?: string;
  [key: string]: unknown;
}

const isExpired = (
  expiresAt?: string,
  now: number = Date.now(),
): boolean => {
  if (expiresAt === undefined) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return true;
  return ts <= now;
};

const findExisting = async (key: string): Promise<RouteCacheEntry | null> => {
  const doc = await db.collection("routing_cache").doc(key).get();
  if (!doc.exists) return null;
  const entry = {id: doc.id, ...doc.data()} as RouteCacheEntry;
  if (isExpired(entry.expiresAt)) return null;
  return entry;
};

const save = async (
  key: string,
  entry: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    stops?: {lat: number; lng: number}[];
    widthBucket: string;
    costing?: string;
    routes: CachedRoute[];
  },
): Promise<void> => {
  const now = new Date();
  await db
    .collection("routing_cache")
    .doc(key)
    .set({
      ...entry,
      routes: JSON.stringify(entry.routes ?? []),
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds() * 1000).toISOString(),
    });
};

const deleteExpired = async (): Promise<number> => {
  const nowIso = new Date().toISOString();
  let deleted = 0;
  for (;;) {
    const snapshot = await db
      .collection("routing_cache")
      .where("expiresAt", "<=", nowIso)
      .limit(500)
      .get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 500) break;
  }
  return deleted;
};

export {
  findExisting,
  save,
  deleteExpired,
  isExpired,
  ttlSeconds,
  DEFAULT_TTL_SECONDS,
  CachedRoute,
};
