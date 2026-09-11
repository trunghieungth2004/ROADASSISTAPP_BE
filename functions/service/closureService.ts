import * as flagRepository from "../repository/flagRepository";
import {STATUS_FLAGS} from "../constants/status";
import {cellsCoveringBounds, lineStringHitsCircles} from "../utils/geo";

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
  [key: string]: unknown;
}

interface RouteAnalysis {
  blocking: BlockingZone[];
  warnings: BlockingZone[];
}

const toZone = (f: {
  id: string;
  type: string;
  lat: number;
  lng: number;
  radiusMeters?: number | null;
  note?: unknown;
}): BlockingZone => {
  const floor =
    BLOCKING_RADIUS_METERS[f.type] ?? DEFAULT_RADIUS_METERS;
  const requested = f.radiusMeters;
  return {
    flagId: f.id,
    type: f.type,
    lat: f.lat,
    lng: f.lng,
    radiusMeters:
      typeof requested === "number" &&
      Number.isFinite(requested) &&
      requested > 0 ?
        Math.max(requested, floor) :
        floor,
    note: f.note ?? null,
    distanceMeters: 0,
  };
};

const computeCells = (geometry: unknown): string[] | null => {
  const raw = (geometry as {coordinates?: unknown} | null)?.coordinates;
  if (!Array.isArray(raw) || raw.length === 0) return null;
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
  if (!Number.isFinite(minLat)) return null;
  return cellsCoveringBounds({
    minLat: minLat - BBOX_MARGIN_DEG,
    maxLat: maxLat + BBOX_MARGIN_DEG,
    minLng: minLng - BBOX_MARGIN_DEG,
    maxLng: maxLng + BBOX_MARGIN_DEG,
  });
};

const analyzeRoute = async (
  geometry: unknown,
  ownerUid?: string,
): Promise<RouteAnalysis> => {
  const empty: RouteAnalysis = {blocking: [], warnings: []};
  const cells = computeCells(geometry);
  if (!cells) return empty;
  const flags = await flagRepository.findByGeohashPrefixes(cells);
  const typed = flags.filter((f) => BLOCKING_TYPES.includes(f.type));
  const isOwn = (f: {reporterUid?: unknown}): boolean =>
    typeof ownerUid === "string" &&
    ownerUid !== "" &&
    f.reporterUid === ownerUid;
  const blockingCandidates = typed
    .filter(
      (f) =>
        BLOCKING_STATUSES.includes(f.status) ||
        (f.status === STATUS_FLAGS.SUGGESTED && isOwn(f)),
    )
    .map(toZone);
  const warningCandidates = typed
    .filter(
      (f) => f.status === STATUS_FLAGS.SUGGESTED && !isOwn(f),
    )
    .map(toZone);
  return {
    blocking: lineStringHitsCircles(geometry, blockingCandidates),
    warnings: lineStringHitsCircles(geometry, warningCandidates),
  };
};

const findBlocking = async (
  geometry: unknown,
  ownerUid?: string,
): Promise<BlockingZone[]> => {
  const {blocking} = await analyzeRoute(geometry, ownerUid);
  return blocking;
};

const findWarnings = async (
  geometry: unknown,
  ownerUid?: string,
): Promise<BlockingZone[]> => {
  const {warnings} = await analyzeRoute(geometry, ownerUid);
  return warnings;
};

export {
  findBlocking,
  findWarnings,
  analyzeRoute,
  BLOCKING_TYPES,
  BLOCKING_STATUSES,
  BLOCKING_RADIUS_METERS,
  DEFAULT_RADIUS_METERS,
  BlockingZone,
  RouteAnalysis,
};
