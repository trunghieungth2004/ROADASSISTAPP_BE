import {db} from "../config/firebase";

interface VehicleProfile {
  id: string;
  type: string;
  baseWidth: number;
  baseHeight: number;
  [key: string]: unknown;
}

interface RideConfig {
  id: string;
  configType: string;
  estWidth?: number | null;
  estHeight?: number | null;
  [key: string]: unknown;
}

const findById = async (
  userId: string,
  profileId: string,
): Promise<VehicleProfile | null> => {
  const doc = await db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .doc(profileId)
    .get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as VehicleProfile;
};

const findByUser = async (userId: string): Promise<VehicleProfile[]> => {
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .get();
  const results: VehicleProfile[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as VehicleProfile),
  );
  return results;
};

const create = async (
  userId: string,
  data: { type: string; baseWidth: number; baseHeight: number },
): Promise<VehicleProfile> => {
  const ref = db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .doc();
  const doc = {id: ref.id, ...data, createdAt: new Date().toISOString()};
  await ref.set(doc);
  return doc;
};

const addRideConfig = async (
  userId: string,
  profileId: string,
  data: {
    configType: string;
    estWidth?: number;
    estHeight?: number;
  },
): Promise<RideConfig> => {
  const ref = db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .doc(profileId)
    .collection("ride_configs")
    .doc();
  const doc = {
    id: ref.id,
    configType: data.configType,
    estWidth: data.estWidth ?? null,
    estHeight: data.estHeight ?? null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findRideConfigs = async (
  userId: string,
  profileId: string,
): Promise<RideConfig[]> => {
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .collection("vehicle_profiles")
    .doc(profileId)
    .collection("ride_configs")
    .get();
  const results: RideConfig[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as RideConfig),
  );
  return results;
};

export {findById, findByUser, create, addRideConfig, findRideConfigs};
