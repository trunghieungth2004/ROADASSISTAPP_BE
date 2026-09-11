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

const valhallaRoute = (
  geometry: {type: string; coordinates: Array<Array<number>>},
  distanceMeters: number,
  durationSeconds: number,
): Record<string, unknown> => ({
  trip: {
    legs: [{shape: encodePolyline(geometry.coordinates)}],
    summary: {length: distanceMeters / 1000, time: durationSeconds},
  },
});

export {encodePolyline, valhallaRoute};
