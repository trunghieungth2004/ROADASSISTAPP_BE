interface RouteOption {
  distanceMeters?: number;
  durationSeconds?: number;
  geometry?: unknown;
  source: string;
  via?: {lat: number; lng: number};
  hazards?: unknown;
  warnings?: unknown;
  steps?: Array<{
    at: [number, number];
    kind: string;
    street?: string;
    distMeters: number;
    durationSec: number;
  }>;
}

interface RouteList {
  cached: boolean;
  routes: RouteOption[];
}

interface BaseRoute {
  geometry: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
  steps?: RouteOption["steps"];
}

export {RouteOption, RouteList, BaseRoute};
