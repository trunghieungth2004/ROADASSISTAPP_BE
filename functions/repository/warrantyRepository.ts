import {db} from "../config/firebase";

const WARRANTY_COLLECTION = "warranty_claims";

const WARRANTY_STATUS = {
  OPEN: "OPEN",
  ACCEPTED: "ACCEPTED",
  REBOOKED: "REBOOKED",
  COMPLETED: "COMPLETED",
  DECLINED: "DECLINED",
  DISPUTED: "DISPUTED",
  RESOLVED: "RESOLVED",
  REJECTED: "REJECTED",
} as const;

interface WarrantyClaim {
  id: string;
  ticketId: string;
  lineId: string;
  serviceCode: string;
  serviceName: string;
  category: string | null;
  riderUid: string;
  providerId: string;
  vehicleId?: string | null;
  vehicleLabel?: string | null;
  vehiclePlate?: string | null;
  lineAmount: number;
  purchasedAt: string | null;
  warrantyUntil: string;
  reason: string;
  photoUrls: string[];
  status: string;
  shopResponse: string | null;
  respondedAt: string | null;
  outcome: string | null;
  refundAmount: number | null;
  refundRequestId: string | null;
  linkedTicketId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  [key: string]: unknown;
}

const create = async (data: {
  ticketId: string;
  lineId: string;
  serviceCode: string;
  serviceName: string;
  category: string | null;
  riderUid: string;
  providerId: string;
  vehicleId?: string | null;
  vehicleLabel?: string | null;
  vehiclePlate?: string | null;
  lineAmount: number;
  purchasedAt: string | null;
  warrantyUntil: string;
  reason: string;
  photoUrls: string[];
}): Promise<WarrantyClaim> => {
  const ref = db.collection(WARRANTY_COLLECTION).doc();
  const row: WarrantyClaim = {
    id: ref.id,
    ...data,
    status: WARRANTY_STATUS.OPEN,
    shopResponse: null,
    respondedAt: null,
    outcome: null,
    refundAmount: null,
    refundRequestId: null,
    linkedTicketId: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(row);
  return row;
};

const findById = async (id: string): Promise<WarrantyClaim | null> => {
  const doc = await db.collection(WARRANTY_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as WarrantyClaim;
};

const findByRider = async (
  riderUid: string,
  limit = 50,
): Promise<WarrantyClaim[]> => {
  const snap = await db
    .collection(WARRANTY_COLLECTION)
    .where("riderUid", "==", riderUid)
    .get();
  const rows: WarrantyClaim[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as WarrantyClaim));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows.slice(0, limit);
};

const findByLine = async (
  lineId: string,
  limit = 10,
): Promise<WarrantyClaim[]> => {
  const snap = await db
    .collection(WARRANTY_COLLECTION)
    .where("lineId", "==", lineId)
    .limit(limit)
    .get();
  const rows: WarrantyClaim[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as WarrantyClaim));
  return rows;
};

const findByStatus = async (
  status: string,
  limit = 100,
): Promise<WarrantyClaim[]> => {
  const snap = await db
    .collection(WARRANTY_COLLECTION)
    .where("status", "==", status)
    .get();
  const rows: WarrantyClaim[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as WarrantyClaim));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return rows.slice(0, limit);
};

const findByProvider = async (
  providerId: string,
  limit = 100,
): Promise<WarrantyClaim[]> => {
  const snap = await db
    .collection(WARRANTY_COLLECTION)
    .where("providerId", "==", providerId)
    .get();
  const rows: WarrantyClaim[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as WarrantyClaim));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows.slice(0, limit);
};

const findAll = async (limit = 100): Promise<WarrantyClaim[]> => {
  const snap = await db
    .collection(WARRANTY_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const rows: WarrantyClaim[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as WarrantyClaim));
  return rows;
};

const update = async (
  id: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection(WARRANTY_COLLECTION).doc(id).update(fields);
};

const findByLinkedTicket = async (
  ticketId: string,
): Promise<WarrantyClaim | null> => {
  const snap = await db
    .collection(WARRANTY_COLLECTION)
    .where("linkedTicketId", "==", ticketId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return {id: doc.id, ...doc.data()} as WarrantyClaim;
};

export {
  WARRANTY_STATUS,
  WarrantyClaim,
  create,
  findById,
  findByRider,
  findByStatus,
  findByProvider,
  findByLine,
  findAll,
  update,
  findByLinkedTicket,
};
