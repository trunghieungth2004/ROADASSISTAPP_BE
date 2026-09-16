import {db, auth} from "../config/firebase";
import {STATUS_USER} from "../constants/status";

const BATCH_SIZE = 400;

interface UserRecord {
  id: string;
  role: string;
  status?: string;
  trustScore?: number;
  volunteerAvailable?: boolean;
  volunteerRadiusKm?: number;
  capability?: string;
  ratingAvg?: number;
  ratingCount?: number;
  activeVehicleId?: string | null;
  onboarded?: boolean;
  services?: string[];
  [key: string]: unknown;
}

const findById = async (userId: string): Promise<UserRecord | null> => {
  const doc = await db.collection("users").doc(userId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as UserRecord;
};

const findActiveById = async (userId: string): Promise<UserRecord | null> => {
  const doc = await db.collection("users").doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as UserRecord;
  if (data.status !== STATUS_USER.ACTIVE) return null;
  return {...data, id: doc.id};
};

const findAll = async (): Promise<UserRecord[]> => {
  const snapshot = await db.collection("users").get();
  const results: UserRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as UserRecord),
  );
  return results;
};

const create = async (
  uid: string,
  data: { email?: string; displayName?: string; role: string },
): Promise<void> => {
  await db
    .collection("users")
    .doc(uid)
    .set({
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      role: data.role,
      status: STATUS_USER.ACTIVE,
      trustScore: 0,
      volunteerAvailable: false,
      volunteerRadiusKm: 5,
      capability: "SOLO_BIKE",
      activeVehicleId: null,
      onboarded: false,
      services: [],
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: new Date().toISOString(),
    });
};

const updateRole = async (userId: string, role: string): Promise<void> => {
  await db.collection("users").doc(userId).update({role});
};

const updateTrustScore = async (
  userId: string,
  trustScore: number,
): Promise<void> => {
  await db.collection("users").doc(userId).update({trustScore});
};

const updateStatus = async (userId: string, status: string): Promise<void> => {
  await db.collection("users").doc(userId).update({status});
  await auth.updateUser(userId, {disabled: status !== STATUS_USER.ACTIVE});
};

const updateProfile = async (
  userId: string,
  displayName: string,
): Promise<void> => {
  await db.collection("users").doc(userId).update({displayName});
  await auth.updateUser(userId, {displayName});
};

const updateVolunteer = async (
  userId: string,
  fields: {
    volunteerAvailable?: boolean;
    volunteerRadiusKm?: number;
    capability?: string;
  },
): Promise<void> => {
  await db.collection("users").doc(userId).update(fields);
};

const updateActiveVehicle = async (
  userId: string,
  profileId: string | null,
): Promise<void> => {
  await db
    .collection("users")
    .doc(userId)
    .update({activeVehicleId: profileId});
};

const updateOnboarded = async (
  userId: string,
  fields: {onboarded: boolean; services: string[]},
): Promise<void> => {
  await db.collection("users").doc(userId).update(fields);
};

const updateRating = async (
  userId: string,
  avg: number,
  count: number,
): Promise<void> => {
  await db.collection("users").doc(userId).update({
    ratingAvg: avg,
    ratingCount: count,
  });
};

const updateRoles = async (
  userIds: string[],
  role: string,
): Promise<number> => {
  let updated = 0;
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const userId of chunk) {
      batch.update(db.collection("users").doc(userId), {role});
    }
    await batch.commit();
    updated += chunk.length;
  }
  return updated;
};

const updateStatuses = async (
  userIds: string[],
  status: string,
): Promise<number> => {
  let updated = 0;
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const userId of chunk) {
      batch.update(db.collection("users").doc(userId), {status});
    }
    await batch.commit();
    updated += chunk.length;
  }
  await Promise.all(
    userIds.map((u) =>
      auth.updateUser(u, {disabled: status !== STATUS_USER.ACTIVE}),
    ),
  );
  return updated;
};

const findByIds = async (
  userIds: string[],
): Promise<Map<string, UserRecord>> => {
  if (!userIds || userIds.length === 0) return new Map();
  const IN_CHUNK_SIZE = 30;
  const map = new Map<string, UserRecord>();
  for (let i = 0; i < userIds.length; i += IN_CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + IN_CHUNK_SIZE);
    const refs = chunk.map((id) => db.collection("users").doc(id));
    const docs = await db.getAll(...refs);
    docs.forEach((doc) => {
      if (doc.exists) {
        map.set(doc.id, {id: doc.id, ...doc.data()} as UserRecord);
      }
    });
  }
  return map;
};

export {
  findById,
  findActiveById,
  findAll,
  create,
  updateRole,
  updateTrustScore,
  updateStatus,
  updateProfile,
  updateVolunteer,
  updateActiveVehicle,
  updateOnboarded,
  updateRating,
  updateRoles,
  updateStatuses,
  findByIds,
};
