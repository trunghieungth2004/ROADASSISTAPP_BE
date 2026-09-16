import {db} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface Shop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  geoHash: string;
  openHours?: string | null;
  accepting?: boolean;
  hasTow?: boolean;
  towVehicleType?: string | null;
  towVehicleWidth?: number | null;
  operatorUid?: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  [key: string]: unknown;
}

const create = async (data: {
  name: string;
  lat: number;
  lng: number;
  type: string;
  openHours?: string;
  accepting?: boolean;
  hasTow?: boolean;
  towVehicleType?: string;
  towVehicleWidth?: number;
  operatorUid?: string;
}): Promise<Shop> => {
  const ref = db.collection("shops").doc();
  const doc = {
    id: ref.id,
    ...data,
    openHours: data.openHours ?? null,
    accepting: data.accepting ?? true,
    hasTow: data.hasTow ?? false,
    towVehicleType: data.towVehicleType ?? null,
    towVehicleWidth: data.towVehicleWidth ?? null,
    operatorUid: data.operatorUid ?? null,
    ratingAvg: 0,
    ratingCount: 0,
    nameLower: data.name.trim().toLowerCase(),
    geoHash: encodeGeohash(data.lat, data.lng, 8),
    geoCell: encodeGeohash(data.lat, data.lng, 6),
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findById = async (shopId: string): Promise<Shop | null> => {
  const doc = await db.collection("shops").doc(shopId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Shop;
};

const update = async (
  shopId: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection("shops").doc(shopId).update(fields);
};

const updateRating = async (
  shopId: string,
  avg: number,
  count: number,
): Promise<void> => {
  await db.collection("shops").doc(shopId).update({
    ratingAvg: avg,
    ratingCount: count,
  });
};

const findByGeohashPrefixes = async (prefixes: string[]): Promise<Shop[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: Shop[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("shops")
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as Shop),
    );
  }
  return results;
};

const findByOperator = async (operatorUid: string): Promise<Shop[]> => {
  const snapshot = await db
    .collection("shops")
    .where("operatorUid", "==", operatorUid)
    .get();
  const results: Shop[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Shop),
  );
  return results;
};

const findByNamePrefix = async (
  prefix: string,
  limit = 5,
): Promise<Shop[]> => {
  const q = prefix.trim().toLowerCase();
  if (!q) return [];
  const snapshot = await db
    .collection("shops")
    .where("nameLower", ">=", q)
    .where("nameLower", "<", `${q}\uf8ff`)
    .limit(limit)
    .get();
  const results: Shop[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Shop),
  );
  return results;
};

export {create, findById, update, updateRating, findByGeohashPrefixes,
  findByNamePrefix, findByOperator};
