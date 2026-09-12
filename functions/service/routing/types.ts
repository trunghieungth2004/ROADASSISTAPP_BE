interface RouteOption {
  distanceMeters?: number;
  durationSeconds?: number;
  geometry?: unknown;
  source: string;
  via?: {lat: number; lng: number};
  hazards?: unknown;
  warnings?: unknown;
}

interface RouteList {
  cached: boolean;
  routes: RouteOption[];
}

interface BaseRoute {
  geometry: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
}

export {RouteOption, RouteList, BaseRoute};
