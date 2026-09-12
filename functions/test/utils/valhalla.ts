const encodePolyline = (coords: Array<Array<number>>): string => {
  let out = "";
  let plat = 0;
  let plng = 0;
  const enc = (v: number): void => {
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of coords) {
    const ilat = Math.round(lat * 1e6);
    const ilng = Math.round(lng * 1e6);
    enc(ilat - plat);
    enc(ilng - plng);
    plat = ilat;
    plng = ilng;
  }
  return out;
};

type RouteSpec = {
  geometry: {type: string; coordinates: Array<Array<number>>};
  distanceMeters: number;
  durationSeconds: number;
};

const tripOf = (spec: RouteSpec): Record<string, unknown> => ({
  legs: [{shape: encodePolyline(spec.geometry.coordinates)}],
  summary: {length: spec.distanceMeters / 1000, time: spec.durationSeconds},
});

const valhallaRoute = (
  geometry: {type: string; coordinates: Array<Array<number>>},
  distanceMeters: number,
  durationSeconds: number,
  alternates: RouteSpec[] = [],
): Record<string, unknown> => ({
  trip: tripOf({geometry, distanceMeters, durationSeconds}),
  ...(alternates.length > 0 ?
    {alternates: alternates.map((spec) => ({trip: tripOf(spec)}))} :
    {}),
});

export {encodePolyline, valhallaRoute, RouteSpec};
