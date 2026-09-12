import * as alleySegmentRepository from
  "../../repository/alleySegmentRepository";
import {computePassability} from "../alleySegmentService";
import * as closureService from "../closureService";
import {
  extractLineCoords,
  pointToSegmentMeters,
  cellsForBounds,
} from "../../utils/geo";

const WIDTH_GATE_RADIUS_METERS = 20;
const WIDTH_PSEUDO_RADIUS_METERS = 20;

interface WidthBlock {
  segmentId: string;
  baseWidth: number;
  distanceMeters: number;
  lat: number;
  lng: number;
}

const toWidthZone = (block: WidthBlock): closureService.BlockingZone => ({
  flagId: `width:${block.segmentId}`,
  type: "WIDTH",
  lat: block.lat,
  lng: block.lng,
  radiusMeters: WIDTH_PSEUDO_RADIUS_METERS,
  note: null,
  distanceMeters: 0,
  raw: block,
});

const toTightZone = (block: WidthBlock): closureService.BlockingZone => ({
  flagId: `tight:${block.segmentId}`,
  type: "WIDTH",
  lat: block.lat,
  lng: block.lng,
  radiusMeters: WIDTH_PSEUDO_RADIUS_METERS,
  note: `${block.baseWidth} m`,
  distanceMeters: block.distanceMeters,
  raw: block,
});

const withTightZones = (
  width: number | undefined,
  tight: WidthBlock[],
  base: unknown,
): unknown => {
  if (width === undefined || tight.length === 0) return base;
  const zones = tight.map(toTightZone);
  return [...(Array.isArray(base) ? base : []), ...zones];
};

const probeWidth = async (
  geometry: unknown,
  width: number,
): Promise<{blocks: WidthBlock[]; tight: WidthBlock[]}> => {
  const coords = extractLineCoords(geometry);
  if (coords.length === 0) return {blocks: [], tight: []};
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
  const segments = await alleySegmentRepository.findByGeohashPrefixes(
    cellsForBounds({minLat, maxLat, minLng, maxLng}, 4),
  );
  const blocks: WidthBlock[] = [];
  const tight: WidthBlock[] = [];
  for (const segment of segments) {
    const lat = (segment as {lat?: unknown}).lat;
    const lng = (segment as {lng?: unknown}).lng;
    const baseWidth = segment.baseWidth;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      typeof baseWidth !== "number"
    ) {
      continue;
    }
    const verdict = computePassability(segment, width);
    if (
      verdict.compatible &&
      verdict.reason !== "TIGHT" &&
      verdict.reason !== "VERY_TIGHT"
    ) {
      continue;
    }
    let nearest = Infinity;
    for (let i = 0; i + 1 < coords.length; i++) {
      nearest = Math.min(
        nearest,
        pointToSegmentMeters(
          lat,
          lng,
          coords[i][1],
          coords[i][0],
          coords[i + 1][1],
          coords[i + 1][0],
        ),
      );
    }
    if (!Number.isFinite(nearest) || nearest > WIDTH_GATE_RADIUS_METERS) {
      continue;
    }
    const entry = {
      segmentId: segment.id,
      baseWidth,
      distanceMeters: Math.round(nearest * 10) / 10,
      lat,
      lng,
    };
    if (verdict.compatible) {
      tight.push(entry);
    } else {
      blocks.push(entry);
    }
  }
  return {blocks, tight};
};

export {
  WidthBlock,
  WIDTH_GATE_RADIUS_METERS,
  WIDTH_PSEUDO_RADIUS_METERS,
  toWidthZone,
  toTightZone,
  withTightZones,
  probeWidth,
};
