import {db} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";
import {PROVIDER_STATUS} from "../constants/status";

interface ProviderService {
  code: string;
  name: string;
  displayPrice: number;
  quoteRequired: boolean;
}

interface Provider {
  id: string;
  kind: string;
  operatorUid: string | null;
  name: string;
  nameLower?: string;
  lat: number;
  lng: number;
  label?: string | null;
  openHours?: string | null;
  vehicleClasses?: string[] | null;
  services?: ProviderService[] | null;
  serviceFee?: number | null;
  accepting?: boolean;
  plate?: string | null;
  plateRaw?: string | null;
  vehicleType?: string | null;
  vehicleWidth?: number | null;
  vehicleProfileId?: string | null;
  towBaseFee?: number | null;
  towPerKmFee?: number | null;
  status: string;
  suspended?: boolean;
  suspendedAt?: string | null;
  suspendedReason?: string | null;
  suspendedBy?: string | null;
  geoHash: string;
  geoCell?: string;
  ratingAvg?: number;
  ratingCount?: number;
  requestedAt?: string;
  decidedAt?: string | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  [key: string]: unknown;
}

export const normalizeTowPlate = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

const createShop = async (data: {
  operatorUid: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  openHours?: string;
  vehicleClasses?: string[];
  services?: ProviderService[];
  serviceFee?: number;
}): Promise<Provider> => {
  const ref = db.collection("providers").doc();
  const doc = {
    id: ref.id,
    kind: "SHOP",
    operatorUid: data.operatorUid,
    name: data.name,
    nameLower: data.name.trim().toLowerCase(),
    lat: data.lat,
    lng: data.lng,
    label: data.label ?? null,
    openHours: data.openHours ?? null,
    vehicleClasses: data.vehicleClasses ?? null,
    services: data.services ?? [],
    serviceFee: data.serviceFee ?? null,
    accepting: false,
    plate: null,
    plateRaw: null,
    vehicleType: null,
    vehicleWidth: null,
    status: PROVIDER_STATUS.PENDING,
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
    geoHash: encodeGeohash(data.lat, data.lng, 8),
    geoCell: encodeGeohash(data.lat, data.lng, 6),
    ratingAvg: 0,
    ratingCount: 0,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    reviewedBy: null,
    reviewNote: null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const createMobileShop = async (data: {
  operatorUid: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  vehicleClasses: string[];
  licenseNumber: string;
  licensePhotoUrl?: string;
  plate: string;
  plateRaw: string;
  vehicleType: string;
  vehicleWidth?: number | null;
  vehicleProfileId?: string | null;
}): Promise<Provider> => {
  const ref = db.collection("providers").doc();
  const doc = {
    id: ref.id,
    kind: "MOBILE_SHOP",
    operatorUid: data.operatorUid,
    name: data.name,
    nameLower: data.name.trim().toLowerCase(),
    lat: data.lat,
    lng: data.lng,
    label: data.label ?? null,
    openHours: null,
    vehicleClasses: data.vehicleClasses,
    services: [],
    serviceFee: null,
    accepting: false,
    plate: data.plate,
    plateRaw: data.plateRaw,
    vehicleType: data.vehicleType,
    vehicleWidth: data.vehicleWidth ?? null,
    vehicleProfileId: data.vehicleProfileId ?? null,
    licenseNumber: data.licenseNumber,
    licensePhotoUrl: data.licensePhotoUrl ?? null,
    status: PROVIDER_STATUS.PENDING,
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
    geoHash: encodeGeohash(data.lat, data.lng, 8),
    geoCell: encodeGeohash(data.lat, data.lng, 6),
    ratingAvg: 0,
    ratingCount: 0,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    reviewedBy: null,
    reviewNote: null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const createTow = async (data: {
  operatorUid: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  plate: string;
  plateRaw: string;
  vehicleType: string;
  vehicleWidth?: number | null;
  vehicleProfileId?: string | null;
  towBaseFee?: number;
  towPerKmFee?: number;
}): Promise<Provider> => {
  const ref = db.collection("providers").doc(data.plate);
  const doc = {
    id: ref.id,
    kind: "TOW",
    operatorUid: data.operatorUid,
    name: data.name,
    nameLower: data.name.trim().toLowerCase(),
    lat: data.lat,
    lng: data.lng,
    label: data.label ?? null,
    openHours: null,
    accepting: false,
    plate: data.plate,
    plateRaw: data.plateRaw,
    vehicleType: data.vehicleType,
    vehicleWidth: data.vehicleWidth ?? null,
    vehicleProfileId: data.vehicleProfileId ?? null,
    towBaseFee: data.towBaseFee ?? null,
    towPerKmFee: data.towPerKmFee ?? null,
    status: PROVIDER_STATUS.PENDING,
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
    geoHash: encodeGeohash(data.lat, data.lng, 8),
    geoCell: encodeGeohash(data.lat, data.lng, 6),
    ratingAvg: 0,
    ratingCount: 0,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    reviewedBy: null,
    reviewNote: null,
    createdAt: new Date().toISOString(),
  };
  await ref.create(doc);
  return doc;
};

const findById = async (providerId: string): Promise<Provider | null> => {
  const doc = await db.collection("providers").doc(providerId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Provider;
};

const findByOperator = async (operatorUid: string): Promise<Provider[]> => {
  const snapshot = await db
    .collection("providers")
    .where("operatorUid", "==", operatorUid)
    .get();
  const results: Provider[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Provider),
  );
  return results;
};

const findByVehicleProfileId = async (
  vehicleProfileId: string,
): Promise<Provider[]> => {
  const snapshot = await db
    .collection("providers")
    .where("vehicleProfileId", "==", vehicleProfileId)
    .get();
  const results: Provider[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Provider),
  );
  return results;
};

const findPending = async (): Promise<Provider[]> => {
  const snapshot = await db
    .collection("providers")
    .where("status", "==", PROVIDER_STATUS.PENDING)
    .get();
  const results: Provider[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Provider),
  );
  return results;
};

const findByPlate = async (plate: string): Promise<Provider | null> => {
  const doc = await db.collection("providers").doc(plate).get();
  if (doc.exists) return {id: doc.id, ...doc.data()} as Provider;
  const snap = await db.collection("providers")
    .where("plate", "==", plate)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const row = snap.docs[0];
  return {id: row.id, ...row.data()} as Provider;
};

const update = async (
  providerId: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection("providers").doc(providerId).update(fields);
};

const decide = async (
  providerId: string,
  patch: {
    status: string;
    reviewedBy: string;
    reviewNote?: string | null;
  },
): Promise<boolean> => {
  let decided = false;
  await db.runTransaction(async (tx) => {
    const ref = db.collection("providers").doc(providerId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    if (data.status !== PROVIDER_STATUS.PENDING) return;
    tx.update(ref, {
      status: patch.status,
      reviewedBy: patch.reviewedBy,
      reviewNote: patch.reviewNote ?? null,
      decidedAt: new Date().toISOString(),
    });
    decided = true;
  });
  return decided;
};

const updateRating = async (
  providerId: string,
  avg: number,
  count: number,
): Promise<void> => {
  await db.collection("providers").doc(providerId).update({
    ratingAvg: avg,
    ratingCount: count,
  });
};

const findByGeohashPrefixes = async (
  prefixes: string[],
): Promise<Provider[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: Provider[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("providers")
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as Provider),
    );
  }
  return results;
};

const findByNamePrefix = async (
  query: string,
  limit = 10,
): Promise<Provider[]> => {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return [];
  const snapshot = await db
    .collection("providers")
    .where("nameLower", ">=", lowered)
    .where("nameLower", "<", `${lowered}\uf8ff`)
    .limit(limit)
    .get();
  const results: Provider[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Provider),
  );
  return results;
};

export {
  Provider,
  ProviderService,
  createShop,
  createMobileShop,
  createTow,
  findById,
  findByOperator,
  findPending,
  findByVehicleProfileId,
  findByPlate,
  update,
  decide,
  updateRating,
  findByGeohashPrefixes,
  findByNamePrefix,
};
