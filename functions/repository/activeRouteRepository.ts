import {db} from "../config/firebase";
import {
  boundsForRadiusMeters,
  cellsForBounds,
  extractLineCoords,
} from "../utils/geo";

interface ActiveRoute {
  routeKey: string;
  userId: string;
  geometry: unknown;
  geoCells: string[];
  expiresAt: string;
  [key: string]: unknown;
}

const ACTIVE_ROUTE_TTL_MS = 30 * 60 * 1000;
const ARRAY_CONTAINS_ANY_CHUNK = 30;

const cellsForGeometry = (geometry: unknown): string[] => {
  const coords = extractLineCoords(geometry);
  if (coords.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return cellsForBounds({minLat, maxLat, minLng, maxLng});
};

const touch = async (
  routeKey: string,
  userId: string,
  geometry: unknown,
): Promise<void> => {
  await db
    .collection("active_routes")
    .doc(routeKey)
    .set({
      routeKey,
      userId,
      geometry: JSON.stringify(geometry ?? null),
      geoCells: cellsForGeometry(geometry),
      expiresAt: new Date(Date.now() + ACTIVE_ROUTE_TTL_MS).toISOString(),
    });
};

const findNearFlag = async (
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<ActiveRoute[]> => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const prefixes = cellsForBounds(bounds);
  const seen = new Set<string>();
  const results: ActiveRoute[] = [];
  const now = Date.now();
  for (let i = 0; i < prefixes.length; i += ARRAY_CONTAINS_ANY_CHUNK) {
    const chunk = prefixes.slice(i, i + ARRAY_CONTAINS_ANY_CHUNK);
    const snapshot = await db
      .collection("active_routes")
      .where("geoCells", "array-contains-any", chunk)
      .get();
    snapshot.forEach((doc) => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      const route = {
        routeKey: doc.id,
        ...doc.data(),
      } as ActiveRoute;
      if (route.expiresAt !== undefined) {
        const ts = Date.parse(route.expiresAt);
        if (!Number.isNaN(ts) && ts <= now) return;
      }
      results.push(route);
    });
  }
  return results;
};

export {
  touch,
  findNearFlag,
  cellsForGeometry,
  ACTIVE_ROUTE_TTL_MS,
};
