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
  providerId?: string | null;
  providerSnapshot?: Record<string, unknown> | null;
  destinationShopId?: string | null;
  destinationSnapshot?: Record<string, unknown> | null;
  destinationPoint?: Record<string, unknown> | null;
  vehicleType?: string | null;
  vehicleWidth?: number | null;
  vehicleClass?: string | null;
  vehicleLabel?: string | null;
  workType?: string | null;
  priceEstimate?: number | null;
  priceCurrency?: string | null;
  shopQuotedAmount?: number | null;
  quotedBy?: string | null;
  quotedAt?: string | null;
  finalAmount?: number | null;
  invoiceRef?: string | null;
  fulfilledByShopId?: string | null;
  declineReason?: string | null;
  declineNote?: string | null;
  expiresAt?: string | null;
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
  providerId?: string;
  providerSnapshot?: Record<string, unknown>;
  destinationShopId?: string;
  destinationSnapshot?: Record<string, unknown>;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleType?: string;
  vehicleWidth?: number;
  vehicleClass?: string;
  vehicleLabel?: string;
  expiresAt?: string;
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
    providerId: data.providerId ?? null,
    providerSnapshot: data.providerSnapshot ?? null,
    destinationShopId: data.destinationShopId ?? null,
    destinationSnapshot: data.destinationSnapshot ?? null,
    destinationPoint: data.destinationPoint ?? null,
    vehicleType: data.vehicleType ?? null,
    vehicleWidth: data.vehicleWidth ?? null,
    vehicleClass: data.vehicleClass ?? null,
    vehicleLabel: data.vehicleLabel ?? null,
    workType: null,
    priceEstimate: null,
    priceCurrency: "VND",
    shopQuotedAmount: null,
    quotedBy: null,
    quotedAt: null,
    finalAmount: null,
    invoiceRef: null,
    fulfilledByShopId: null,
    declineReason: null,
    declineNote: null,
    expiresAt: data.expiresAt ?? null,
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

const claimForAssignment = async (
  ticketId: string,
  fields: Record<string, unknown>,
): Promise<boolean> => {
  let claimed = false;
  await db.runTransaction(async (tx) => {
    const ref = db.collection("dispatch_tickets").doc(ticketId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    if (data.status !== STATUS_DISPATCH.PENDING) return;
    tx.update(ref, {...fields, candidates: []});
    claimed = true;
  });
  return claimed;
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

const ACTIVE_TICKET_STATUSES: Set<string> = new Set([
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.ARRIVED,
  STATUS_DISPATCH.IN_PROGRESS,
  STATUS_DISPATCH.READY,
]);

const findByStatusForTypes = async (
  status: string,
  ticketTypes: string[],
  limit = 200,
): Promise<DispatchTicket[]> => {
  const out: DispatchTicket[] = [];
  for (const ticketType of ticketTypes) {
    const snap = await db
      .collection("dispatch_tickets")
      .where("status", "==", status)
      .where("ticketType", "==", ticketType)
      .limit(limit)
      .get();
    snap.forEach((doc) =>
      out.push({id: doc.id, ...doc.data()} as DispatchTicket),
    );
  }
  return out;
};

const findByUserId = async (
  userId: string,
  limit = 50,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("userId", "==", userId)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  results.sort((a, b) =>
    String(b.createdAt ?? "") < String(a.createdAt ?? "") ? -1 : 1,
  );
  return results.slice(0, limit);
};

const findActiveForUid = async (
  uid: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("assignedUid", "==", uid)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (ACTIVE_TICKET_STATUSES.has(ticket.status)) results.push(ticket);
  });
  return results;
};

const findByAssignee = async (
  uid: string,
  limit = 50,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("assignedUid", "==", uid)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  results.sort((a, b) =>
    String(b.createdAt ?? "") < String(a.createdAt ?? "") ? -1 : 1,
  );
  return results.slice(0, limit);
};

const findActiveForShop = async (
  shopId: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("assignedShopId", "==", shopId)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (ACTIVE_TICKET_STATUSES.has(ticket.status)) results.push(ticket);
  });
  return results;
};

const findStaleWalkIns = async (
  nowIso: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("ticketType", "==", "WALK_IN")
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (ticket.status !== STATUS_DISPATCH.PENDING) return;
    if (typeof ticket.expiresAt !== "string" || ticket.expiresAt > nowIso) {
      return;
    }
    results.push(ticket);
  });
  return results;
};

const findPendingForShop = async (
  shopId: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("providerId", "==", shopId)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (ticket.status === STATUS_DISPATCH.PENDING) results.push(ticket);
  });
  results.sort((a, b) =>
    String(a.createdAt ?? "") < String(b.createdAt ?? "") ? 1 : -1,
  );
  return results;
};

const findRecentForShop = async (
  shopId: string,
  limit = 20,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("assignedShopId", "==", shopId)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  results.sort((a, b) =>
    String(a.createdAt ?? "") < String(b.createdAt ?? "") ? 1 : -1,
  );
  return results.slice(0, limit);
};

const findBusyUids = async (uids: string[]): Promise<Set<string>> => {
  const busy = new Set<string>();
  if (uids.length === 0) return busy;
  const IN_CHUNK_SIZE = 30;
  for (let i = 0; i < uids.length; i += IN_CHUNK_SIZE) {
    const chunk = uids.slice(i, i + IN_CHUNK_SIZE);
    const snap = await db
      .collection("dispatch_tickets")
      .where("assignedUid", "in", chunk)
      .get();
    snap.forEach((doc) => {
      const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
      if (
        ACTIVE_TICKET_STATUSES.has(ticket.status) &&
        typeof ticket.assignedUid === "string"
      ) {
        busy.add(ticket.assignedUid);
      }
    });
  }
  return busy;
};

export {create, findById, updateStatus, update, claimForAssignment,
  findByStatus, findByStatusForTypes, findByUserId, findActiveForUid,
  findByAssignee, findActiveForShop, findPendingForShop, findRecentForShop,
  findStaleWalkIns,
  findBusyUids, ACTIVE_TICKET_STATUSES};
