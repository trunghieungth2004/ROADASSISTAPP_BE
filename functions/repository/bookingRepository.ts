import {db} from "../config/firebase";
import {
  BOOKING_STATUS,
} from "../constants/booking";
import {ConflictError} from "../utils/errors";

const COLLECTION = "bookings";
const SLOT_COLLECTION = "booking_slots";

interface Booking {
  id: string;
  riderUid: string;
  providerId: string;
  providerName: string;
  providerSnapshot?: Record<string, unknown> | null;
  serviceCodes: string[];
  serviceSnapshot?: Array<{code: string; name: string; price: number}>;
  scheduledAt: string;
  slotKey: string;
  status: string;
  note: string | null;
  vehicleId: string | null;
  arrivalMode: string;
  origin: {lat: number; lng: number; label?: string | null} | null;
  linkedTicketIds: string[];
  reminder: {
    mode: string;
    bufferMinutes: number;
    reminderAt: string | null;
    sentAt: string | null;
  } | null;
  outsideHours: boolean;
  depositAmount: number;
  depositStatus: string;
  depositCollectedAt: string | null;
  depositCollectedBy: string | null;
  reminderSentAt: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  ticketId: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface Slot {
  id: string;
  providerId: string;
  date: string;
  slot: string;
  count: number;
}

const create = async (data: {
  riderUid: string;
  providerId: string;
  providerName: string;
  providerSnapshot?: Record<string, unknown> | null;
  serviceCodes: string[];
  serviceSnapshot: Array<{code: string; name: string; price: number}>;
  scheduledAt: string;
  slotKey: string;
  note?: string | null;
  vehicleId?: string | null;
  arrivalMode: string;
  origin?: {lat: number; lng: number; label?: string | null} | null;
  reminder?: {
    mode: string;
    bufferMinutes: number;
    reminderAt: string | null;
  } | null;
  outsideHours: boolean;
  depositAmount: number;
  depositStatus: string;
}): Promise<Booking> => {
  const ref = db.collection(COLLECTION).doc();
  const now = new Date().toISOString();
  const doc: Booking = {
    id: ref.id,
    riderUid: data.riderUid,
    providerId: data.providerId,
    providerName: data.providerName,
    providerSnapshot: data.providerSnapshot ?? null,
    serviceCodes: data.serviceCodes,
    serviceSnapshot: data.serviceSnapshot,
    scheduledAt: data.scheduledAt,
    slotKey: data.slotKey,
    status: BOOKING_STATUS.REQUESTED,
    note: data.note ?? null,
    vehicleId: data.vehicleId ?? null,
    arrivalMode: data.arrivalMode,
    origin: data.origin ?? null,
    linkedTicketIds: [],
    reminder: data.reminder === undefined || data.reminder === null ?
      null :
      {...data.reminder, sentAt: null},
    outsideHours: data.outsideHours,
    depositAmount: data.depositAmount,
    depositStatus: data.depositStatus,
    depositCollectedAt: null,
    depositCollectedBy: null,
    reminderSentAt: null,
    confirmedAt: null,
    declinedAt: null,
    declineReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    arrivedAt: null,
    completedAt: null,
    noShowAt: null,
    ticketId: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<Booking | null> => {
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return {id: snap.id, ...snap.data()} as Booking;
};

const update = async (
  id: string,
  patch: Record<string, unknown>,
): Promise<void> => {
  await db.collection(COLLECTION).doc(id).update({
    ...patch,
    updatedAt: new Date().toISOString(),
  });
};

const findByRider = async (
  riderUid: string,
  limit = 50,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("riderUid", "==", riderUid)
    .orderBy("scheduledAt", "desc")
    .limit(limit)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const findByShop = async (
  providerId: string,
  limit = 50,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("providerId", "==", providerId)
    .orderBy("scheduledAt", "desc")
    .limit(limit)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const findForDay = async (
  providerId: string,
  startIso: string,
  endIso: string,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("providerId", "==", providerId)
    .where("scheduledAt", ">=", startIso)
    .where("scheduledAt", "<", endIso)
    .where("status", "==", BOOKING_STATUS.CONFIRMED)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const findReminderDue = async (
  nowIso: string,
  untilIso: string,
  limit = 200,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", BOOKING_STATUS.CONFIRMED)
    .where("scheduledAt", ">=", nowIso)
    .where("scheduledAt", "<=", untilIso)
    .where("reminderSentAt", "==", null)
    .limit(limit)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const findReminderDueV2 = async (
  nowIso: string,
  limit = 200,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", BOOKING_STATUS.CONFIRMED)
    .where("reminder.reminderAt", "<=", nowIso)
    .where("reminder.sentAt", "==", null)
    .limit(limit)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const findNoShowDue = async (
  thresholdIso: string,
  limit = 200,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", BOOKING_STATUS.CONFIRMED)
    .where("scheduledAt", "<=", thresholdIso)
    .limit(limit)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const findArrivedBefore = async (
  thresholdIso: string,
  limit = 200,
): Promise<Booking[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", BOOKING_STATUS.ARRIVED)
    .where("arrivedAt", "<=", thresholdIso)
    .limit(limit)
    .get();
  const out: Booking[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as Booking));
  return out;
};

const slotId = (providerId: string, date: string, slot: string): string =>
  `${providerId}:${date}:${slot}`;

const claimSlot = async (
  providerId: string,
  date: string,
  slot: string,
  capacity: number,
): Promise<void> => {
  const id = slotId(providerId, date, slot);
  const ref = db.collection(SLOT_COLLECTION).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data()?.count as number) : 0;
    if (current >= capacity) {
      throw new ConflictError("That time was just taken");
    }
    tx.set(ref, {
      id: ref.id,
      providerId,
      date,
      slot,
      count: current + 1,
    });
  });
};

const releaseSlot = async (
  providerId: string,
  date: string,
  slot: string,
): Promise<void> => {
  const id = slotId(providerId, date, slot);
  const ref = db.collection(SLOT_COLLECTION).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = (snap.data()?.count as number) ?? 0;
    tx.set(ref, {
      id: ref.id,
      providerId,
      date,
      slot,
      count: Math.max(0, current - 1),
    });
  });
};

export {
  create,
  findById,
  update,
  findByRider,
  findByShop,
  findForDay,
  findReminderDue,
  findReminderDueV2,
  findNoShowDue,
  findArrivedBefore,
  claimSlot,
  releaseSlot,
};
export type {Booking, Slot};
