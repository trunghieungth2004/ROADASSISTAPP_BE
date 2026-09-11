interface LatLng {
  lat: number;
  lng: number;
}

type Ring = Array<[number, number]>;

interface ValhallaRoute {
  geometry: {type: "LineString"; coordinates: Array<[number, number]>};
  distanceMeters: number;
  durationSeconds: number;
}

class ServiceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALHALLA_URL = process.env.VALHALLA_URL || "http://localhost:8002";
const VALHALLA_TIMEOUT_MS = 15000;
const VALHALLA_COSTING = "motor_scooter";
const RING_STEPS = 32;

const decodePolyline6 = (encoded: string): Array<[number, number]> => {
  const factor = 1e6;
  const coords: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
};

const circleToRing = (
  lat: number,
  lng: number,
  radiusMeters: number,
  steps = RING_STEPS,
): Ring => {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0
  ) {
    return [];
  }
  const count = Math.max(8, Math.floor(steps));
  const ring: Ring = [];
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    ring.push([
      lng + (radiusMeters * Math.sin(angle)) / (111320 * cosLat),
      lat + (radiusMeters * Math.cos(angle)) / 111320,
    ]);
  }
  const first = ring[0];
  ring.push([first[0], first[1]]);
  return ring;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as {
      error?: unknown;
      error_code?: unknown;
    };
    if (typeof body.error === "string") return body.error;
    if (typeof body.error_code === "number") return String(body.error_code);
  } catch {
    // fall through to the status-based error below
  }
  return "";
};

const postRoute = async (
  locations: LatLng[],
  excludePolygons: Ring[] = [],
): Promise<ValhallaRoute> => {
  const body: Record<string, unknown> = {
    locations: locations.map((p) => ({lat: p.lat, lon: p.lng})),
    costing: VALHALLA_COSTING,
  };
  const rings = excludePolygons.filter((ring) => ring.length >= 4);
  if (rings.length > 0) body.exclude_polygons = rings;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(`${VALHALLA_URL}/route`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(VALHALLA_TIMEOUT_MS),
      });
      break;
    } catch {
      response = null;
      if (attempt === 1) {
        throw new ServiceError("Routing service unreachable");
      }
    }
  }
  if (!response) {
    throw new ServiceError("Routing service unreachable");
  }
  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (
      response.status === 400 &&
      (/no path could be found/i.test(message) || message === "442")
    ) {
      throw new ServiceError("No route found", 404);
    }
    throw new ServiceError(`Routing service returned ${response.status}`);
  }
  const data = (await response.json()) as {
    trip?: {
      legs?: Array<{shape?: unknown}>;
      summary?: {length?: unknown; time?: unknown};
    };
  };
  const legs = data?.trip?.legs;
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new ServiceError("No route found", 404);
  }
  const coords: Array<[number, number]> = [];
  for (const leg of legs) {
    const shape = (leg as {shape?: unknown})?.shape;
    if (typeof shape !== "string" || shape.length === 0) {
      throw new ServiceError("No route found", 404);
    }
    for (const pt of decodePolyline6(shape)) {
      const prev = coords[coords.length - 1];
      if (
        prev &&
        Math.abs(prev[0] - pt[0]) < 1e-9 &&
        Math.abs(prev[1] - pt[1]) < 1e-9
      ) {
        continue;
      }
      coords.push(pt);
    }
  }
  if (coords.length === 0) {
    throw new ServiceError("No route found", 404);
  }
  const summary = data.trip?.summary ?? {};
  const distanceMeters =
    typeof summary.length === "number" ? summary.length * 1000 : NaN;
  const durationSeconds =
    typeof summary.time === "number" ? summary.time : NaN;
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
    throw new ServiceError("No route found", 404);
  }
  return {
    geometry: {type: "LineString", coordinates: coords},
    distanceMeters,
    durationSeconds,
  };
};

export {
  postRoute,
  decodePolyline6,
  circleToRing,
  VALHALLA_URL,
  VALHALLA_COSTING,
  ServiceError,
  LatLng,
  ValhallaRoute,
};
