import * as flagRepository from "../repository/flagRepository";
import {STATUS_FLAGS} from "../constants/status";
import {cellsForBounds, lineStringHitsCircles} from "../utils/geo";

const BLOCKING_TYPES = ["FLOOD", "OBSTRUCTION", "ACCIDENT"];
const BLOCKING_STATUSES: string[] = [
  STATUS_FLAGS.CONFIRMED,
  STATUS_FLAGS.LOCKED,
];
const BLOCKING_RADIUS_METERS: Record<string, number> = {
  FLOOD: 200,
  OBSTRUCTION: 100,
  ACCIDENT: 100,
};
const DEFAULT_RADIUS_METERS = 200;
const BBOX_MARGIN_DEG = 0.03;

interface BlockingZone {
  flagId: string;
  type: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  note: unknown;
  distanceMeters: number;
}

const findBlocking = async (geometry: unknown): Promise<BlockingZone[]> => {
  const raw = (geometry as {coordinates?: unknown} | null)?.coordinates;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pt of raw) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const [lng, lat] = pt as [unknown, unknown];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  if (!Number.isFinite(minLat)) return [];
  const cells = cellsForBounds({
    minLat: minLat - BBOX_MARGIN_DEG,
    maxLat: maxLat + BBOX_MARGIN_DEG,
    minLng: minLng - BBOX_MARGIN_DEG,
    maxLng: maxLng + BBOX_MARGIN_DEG,
  });
  const flags = await flagRepository.findByGeohashPrefixes(cells);
  const candidates = flags
    .filter(
      (f) =>
        BLOCKING_TYPES.includes(f.type) &&
        BLOCKING_STATUSES.includes(f.status),
    )
    .map((f) => ({
      flagId: f.id,
      type: f.type,
      lat: f.lat,
      lng: f.lng,
      radiusMeters:
        (f.radiusMeters as number | null | undefined) ??
        BLOCKING_RADIUS_METERS[f.type] ??
        DEFAULT_RADIUS_METERS,
      note: f.note ?? null,
    }));
  return lineStringHitsCircles(geometry, candidates);
};

export {
  findBlocking,
  BLOCKING_TYPES,
  BLOCKING_STATUSES,
  BLOCKING_RADIUS_METERS,
  DEFAULT_RADIUS_METERS,
  BlockingZone,
};
