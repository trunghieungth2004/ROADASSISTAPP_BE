import {db} from "../config/firebase";
import {
  SUPPORT_LIST_LIMIT,
  SUPPORT_STATUS,
} from "../constants/support";

const COLLECTION = "support_tickets";

interface SupportTicket {
  id: string;
  userId: string;
  ticketId: string | null;
  category: string;
  message: string;
  status: string;
  answer: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const create = async (data: {
  userId: string;
  ticketId?: string | null;
  category: string;
  message: string;
}): Promise<SupportTicket> => {
  const ref = db.collection(COLLECTION).doc();
  const now = new Date().toISOString();
  const doc: SupportTicket = {
    id: ref.id,
    userId: data.userId,
    ticketId: data.ticketId ?? null,
    category: data.category,
    message: data.message,
    status: SUPPORT_STATUS.OPEN,
    answer: null,
    answeredAt: null,
    answeredBy: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<SupportTicket | null> => {
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return {id: snap.id, ...snap.data()} as SupportTicket;
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

const findByUser = async (
  userId: string,
  limit = SUPPORT_LIST_LIMIT,
): Promise<SupportTicket[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const out: SupportTicket[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as SupportTicket));
  return out;
};

const findByStatus = async (
  status: string,
  limit = SUPPORT_LIST_LIMIT,
): Promise<SupportTicket[]> => {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", status)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();
  const out: SupportTicket[] = [];
  snap.forEach((doc) => out.push({id: doc.id, ...doc.data()} as SupportTicket));
  return out;
};

export {create, findById, update, findByUser, findByStatus};
export type {SupportTicket};
