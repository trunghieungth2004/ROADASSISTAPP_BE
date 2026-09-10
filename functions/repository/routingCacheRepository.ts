import {db} from "../config/firebase";

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

const ttlSeconds = (): number => {
  const raw = Number(process.env.ROUTING_CACHE_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return raw;
};

interface RouteCacheEntry {
  id: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops?: {lat: number; lng: number}[];
  widthBucket: string;
  geometry: unknown;
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
    geometry: unknown;
    distanceMeters?: number;
    durationSeconds?: number;
  },
): Promise<void> => {
  const now = new Date();
  await db
    .collection("routing_cache")
    .doc(key)
    .set({
      ...entry,
      geometry: JSON.stringify(entry.geometry ?? null),
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds() * 1000).toISOString(),
    });
};

export {findExisting, save, isExpired, ttlSeconds, DEFAULT_TTL_SECONDS};
