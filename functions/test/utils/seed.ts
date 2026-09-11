import {db, Timestamp} from "../../config/firebase";
import {STATUS_USER} from "../../constants/status";
import {encodeGeohash} from "../../utils/geo";

const PREFIX = "IT";
const BASE_LAT = 10.7626;
const BASE_LNG = 106.6602;

const ALL_COLLECTIONS = [
  "users",
  "roles",
  "statuses",
  "alley_segments",
  "flags",
  "landmarks",
  "shops",
  "diagnostics",
  "dispatch_tickets",
  "routing_cache",
  "saved_routes",
];

const cleanCollection = async (name: string): Promise<void> => {
  const snap = await db.collection(name).get();
  if (snap.docs.length === 0) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
};

const cleanAll = async (): Promise<void> => {
  for (const col of ALL_COLLECTIONS) {
    await cleanCollection(col);
  }
  const users = await db.collection("users").get();
  for (const user of users.docs) {
    const profiles = await user.ref.collection("vehicle_profiles").get();
    for (const profile of profiles.docs) {
      const configs = await profile.ref.collection("ride_configs").get();
      if (configs.docs.length > 0) {
        const batch = db.batch();
        configs.docs.forEach((c) => batch.delete(c.ref));
        await batch.commit();
      }
      await profile.ref.delete();
    }
  }
};

const seedUser = async (
  id: string,
  role: string = "2",
  status: string = STATUS_USER.ACTIVE,
  trustScore = 0,
): Promise<string> => {
  await db.collection("users").doc(id).set({
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    role,
    status,
    trustScore,
    createdAt: new Date().toISOString(),
  });
  return id;
};

const seedRole = async (
  code: string,
  name: string,
  description: string,
): Promise<string> => {
  await db.collection("roles").doc(code).set({name, description});
  return code;
};

const seedStatus = async (
  domain: string,
  code: string,
  name: string,
  description: string,
  order = 0,
): Promise<string> => {
  const id = `${domain}:${code}`;
  await db
    .collection("statuses")
    .doc(id)
    .set({domain, code, name, description, order});
  return id;
};

const seedProfile = async (
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .doc();
  await ref.set({
    type: "SCOOTER",
    baseWidth: 0.7,
    baseHeight: 1.1,
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedRideConfig = async (
  userId: string,
  profileId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .doc(profileId)
    .collection("ride_configs")
    .doc();
  await ref.set({
    configType: "SOLO",
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedSegment = async (
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("alley_segments").doc();
  const lat = (overrides.lat as number) ?? BASE_LAT;
  const lng = (overrides.lng as number) ?? BASE_LNG;
  await ref.set({
    lat,
    lng,
    geoHash: encodeGeohash(lat, lng, 9),
    geoCell: encodeGeohash(lat, lng, 4),
    baseWidth: 1.2,
    wireHeight: 2.5,
    inclinePct: 4,
    tier: "TIER2",
    verifiedCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedFlag = async (
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("flags").doc();
  const lat = (overrides.lat as number) ?? BASE_LAT;
  const lng = (overrides.lng as number) ?? BASE_LNG;
  await ref.set({
    type: "FLOOD",
    status: "1",
    geoHash: encodeGeohash(lat, lng, 7),
    geoCell: encodeGeohash(lat, lng, 5),
    lat,
    lng,
    voteCount: 0,
    reporterUid: `${PREFIX}-user-1`,
    reporterTrust: 0,
    note: null,
    createdAt: new Date().toISOString(),
    ttlExpiresAt: Timestamp.fromDate(
      new Date(Date.now() + 3 * 60 * 60 * 1000),
    ),
    ...overrides,
  });
  return ref.id;
};

const seedLandmark = async (
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("landmarks").doc();
  const lat = (overrides.lat as number) ?? BASE_LAT;
  const lng = (overrides.lng as number) ?? BASE_LNG;
  await ref.set({
    lat,
    lng,
    displayLabel: `Landmark ${ref.id}`,
    geoHash: encodeGeohash(lat, lng, 8),
    geoCell: encodeGeohash(lat, lng, 6),
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedShop = async (
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("shops").doc();
  const lat = (overrides.lat as number) ?? BASE_LAT;
  const lng = (overrides.lng as number) ?? BASE_LNG;
  await ref.set({
    name: `Shop ${ref.id}`,
    lat,
    lng,
    type: "SHOP",
    geoHash: encodeGeohash(lat, lng, 8),
    geoCell: encodeGeohash(lat, lng, 6),
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedDiagnostic = async (
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("diagnostics").doc();
  await ref.set({
    userId: `${PREFIX}-user-1`,
    category: "FLAT_TIRE",
    imagePath: `diagnostics/${ref.id}.jpg`,
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedTicket = async (
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("dispatch_tickets").doc();
  await ref.set({
    userId: `${PREFIX}-user-1`,
    ticketType: "TOW",
    status: "1",
    lat: BASE_LAT,
    lng: BASE_LNG,
    diagnosticId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return ref.id;
};

const seedRoute = async (
  key: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const {geometry, ...rest} = overrides;
  await db.collection("routing_cache").doc(key).set({
    originLat: BASE_LAT,
    originLng: BASE_LNG,
    destLat: 10.7758,
    destLng: 106.7019,
    widthBucket: "MEDIUM",
    geometry: JSON.stringify(
      geometry ?? {type: "LineString", coordinates: []},
    ),
    cachedAt: new Date().toISOString(),
    ...rest,
  });
  return key;
};

export {
  db,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
  ALL_COLLECTIONS,
  cleanCollection,
  cleanAll,
  seedUser,
  seedRole,
  seedStatus,
  seedProfile,
  seedRideConfig,
  seedSegment,
  seedFlag,
  seedLandmark,
  seedShop,
  seedDiagnostic,
  seedTicket,
  seedRoute,
};
