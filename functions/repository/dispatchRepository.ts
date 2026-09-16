import {db} from "../config/firebase";
import {STATUS_DISPATCH} from "../constants/status";

interface DispatchTicket {
  id: string;
  userId: string;
  ticketType: string;
  status: string;
  lat: number;
  lng: number;
  diagnosticId?: string | null;
  alleySegmentId?: string | null;
  accessWidthMeters?: number | null;
  note?: string | null;
  destinationShopId?: string | null;
  destinationSnapshot?: Record<string, unknown> | null;
  destinationPoint?: Record<string, unknown> | null;
  vehicleType?: string | null;
  vehicleWidth?: number | null;
  suggestedShopId?: string | null;
  assignedUid?: string | null;
  assignedShopId?: string | null;
  assignedKind?: string | null;
  candidates?: string[];
  candidateTs?: string | null;
  riderRating?: number | null;
  helperRating?: number | null;
  [key: string]: unknown;
}

const create = async (data: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
  alleySegmentId?: string;
  accessWidthMeters?: number;
  note?: string;
  destinationShopId?: string;
  destinationSnapshot?: Record<string, unknown>;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleType?: string;
  vehicleWidth?: number;
}): Promise<DispatchTicket> => {
  const ref = db.collection("dispatch_tickets").doc();
  const doc = {
    id: ref.id,
    userId: data.userId,
    ticketType: data.ticketType,
    lat: data.lat,
    lng: data.lng,
    diagnosticId: data.diagnosticId ?? null,
    alleySegmentId: data.alleySegmentId ?? null,
    accessWidthMeters: data.accessWidthMeters ?? null,
    note: data.note ?? null,
    destinationShopId: data.destinationShopId ?? null,
    destinationSnapshot: data.destinationSnapshot ?? null,
    destinationPoint: data.destinationPoint ?? null,
    vehicleType: data.vehicleType ?? null,
    vehicleWidth: data.vehicleWidth ?? null,
    suggestedShopId: null,
    assignedUid: null,
    assignedShopId: null,
    assignedKind: null,
    candidates: [],
    candidateTs: null,
    riderRating: null,
    helperRating: null,
    status: STATUS_DISPATCH.PENDING,
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<DispatchTicket | null> => {
  const doc = await db.collection("dispatch_tickets").doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as DispatchTicket;
};

const updateStatus = async (id: string, status: string): Promise<void> => {
  await db.collection("dispatch_tickets").doc(id).update({status});
};

const update = async (
  id: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection("dispatch_tickets").doc(id).update(fields);
};

const findByStatus = async (
  status: string,
  limit = 200,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("status", "==", status)
    .limit(limit)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  return results;
};

const findActiveForUid = async (
  uid: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("assignedUid", "==", uid)
    .get();
  const active: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
  ]);
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (active.has(ticket.status)) results.push(ticket);
  });
  return results;
};

const findActiveForShop = async (
  shopId: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("assignedShopId", "==", shopId)
    .get();
  const active: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
  ]);
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (active.has(ticket.status)) results.push(ticket);
  });
  return results;
};

export {create, findById, updateStatus, update, findByStatus,
  findActiveForUid, findActiveForShop};
