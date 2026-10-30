import * as closureService from "../closureService";

interface WidthBlock {
  segmentId: string;
  baseWidth: number;
  distanceMeters: number;
  lat: number;
  lng: number;
}

const WIDTH_GATE_RADIUS_METERS = 20;
const WIDTH_PSEUDO_RADIUS_METERS = 20;

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
  _width: number | undefined,
  _tight: WidthBlock[],
  base: unknown,
): unknown => base;

const probeWidth = async (
  geometry: unknown,
  width: number,
): Promise<{blocks: WidthBlock[]; tight: WidthBlock[]}> => {
  void geometry;
  void width;
  return {blocks: [], tight: []};
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
