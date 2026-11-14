import {db, FieldValue} from "../config/firebase";
import {STATUS_DISPATCH} from "../constants/status";
import {TERMINAL_STATUSES} from "../constants/dispatch";

interface DispatchTicket {
  id: string;
  userId: string;
  ticketType: string;
  status: string;
  lat: number;
  lng: number;
  symptom?: string | null;
  note?: string | null;
  description?: string | null;
  photoUrls?: string[];
  quoteRequests?: Array<{
    shopId: string;
    status: string;
    expiresAt: string;
  }>;
  quotes?: Array<{
    shopId: string;
    amount: number;
    eta?: number | null;
    note?: string | null;
    expiresAt: string;
    kind: string;
    at: string;
  }>;
  declinedShopIds?: string[];
  pickupHistory?: Array<{
    lat: number;
    lng: number;
    at: string;
    reason: string;
  }>;
  needsNewDestination?: boolean;
  towerSearch?: string;
  waiting?: {
    active: boolean;
    startedAt: string | null;
    endedAt: string | null;
    fee: number | null;
  } | null;
  paymentId?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  checkoutUrl?: string | null;
  towActual?: {
    quotedKm: number | null;
    actualKm: number | null;
    cappedKm: number | null;
    loadedTraveledKm?: number | null;
    breakdown?: boolean;
  } | null;
  jobTrack?: Array<{
    lat: number;
    lng: number;
    at: string;
    shopId?: string | null;
  }>;
  providerId?: string | null;
  providerSnapshot?: Record<string, unknown> | null;
  destinationShopId?: string | null;
  destinationSnapshot?: Record<string, unknown> | null;
  destinationPoint?: Record<string, unknown> | null;
  destinationDecline?: {
    shopId: string;
    reasonCode: string;
    by: string;
    at: string;
  } | null;
  vehicleId?: string | null;
  vehicleType?: string | null; vehicleWidth?: number | null;
  vehicleClass?: string | null; vehicleLabel?: string | null;
  vehiclePlate?: string | null;
  vehicleHeight?: number | null;
  workType?: string | null;
  quoteItems?: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }> | null;
  invoiceItems?: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }> | null;
  quoteVersion?: number;
  invoiceAmount?: number | null;
  invoiceApproval?: string | null;
  invoiceVersion?: number;
  invoiceApprovedAt?: string | null;
  quoteHistory?: Array<{
    version: number;
    amount: number;
    items: Array<{
      name: string;
      qty: number;
      unitPrice: number;
      amount: number;
    }>;
    at: string;
    by: string;
    status?: string;
    reason?: string;
  }>;
  priceEstimate?: number | null;
  priceCurrency?: string | null;
  shopQuotedAmount?: number | null;
  quotedBy?: string | null;
  quotedAt?: string | null;
  finalAmount?: number | null;
  mobileCallOutFee?: number | null; mobileCallOutWaived?: boolean | null;
  mobileTravelFee?: number | null; mobileTravelKm?: number | null;
  mobileTravelRate?: number | null; mobileTravelSource?: string | null;
  mobileFeeHistory?: Array<{
    shopId: string;
    shopName?: string | null;
    callOutFee: number;
    travelFee: number;
    waived: boolean;
    fixAmount?: number | null;
    items?: Array<{
      name: string;
      qty: number;
      unitPrice: number;
      amount: number;
    }>;
    declinedAt: string;
    reason?: string | null;
  }>;
  mobileFixApprovedAt?: string | null;
  mobileFixDeclinedAt?: string | null;
  mobileFixDeclineReason?: string | null;
  quoteDeclinedAt?: string | null;
  quoteDeclineReason?: string | null;
  preQuoteStatus?: string | null;
  towFeeHistory?: Array<{
    shopId: string;
    shopName?: string | null;
    amount: number;
    deadheadKm: number;
    loadedKm: number;
    at: string;
    reasonCode?: string | null;
  }>;
  towFeeCap?: number | null;
  chatVersion?: number;
  chatHistory?: Array<{
    version: number;
    roomId: string;
    shopId: string;
    shopName?: string | null;
    at: string;
  }>;
  mobileTowOffer?: {
    status: string;
    shopId: string;
    destinationShopId: string | null;
    mode: string;
    towProviderId: string | null;
    by: string;
    at: string;
    expiresAt?: string | null;
  } | null;
  returnTowOffer?: {
    status: string;
    shopId: string;
    by: string;
    at: string;
  } | null;
  faultPhotos?: string[];
  estimateAmount?: number | null;
  estimateNote?: string | null;
  estimateEta?: number | null;
  estimateExpiresAt?: string | null;
  estimateBy?: string | null;
  estimatedAt?: string | null;
  estimateApprovedAt?: string | null;
  paymentArmed?: boolean | null;
  quoteApprovedAt?: string | null;
  unfixable?: {
    reason: string;
    photoUrls: string[];
    by: string;
    at: string;
  } | null;
  unfixGraceAt?: string | null;
  sosAttempt?: number;
  continuedFromTicketId?: string | null;
  continuationTicketId?: string | null;
  excludedShopIds?: string[];
  excludedOperatorUids?: string[];
  sourceTicketId?: string | null;
  bookingId?: string | null;
  depositAmount?: number | null;
  depositStatus?: string | null;
  depositMethod?: string | null;
  depositPaymentId?: string | null;
  depositPaidAt?: string | null;
  depositCollectedBy?: string | null;
  invoiceRef?: string | null;
  fulfilledByShopId?: string | null;
  declineReason?: string | null;
  declineNote?: string | null;
  towLegs?: Array<{
    toShopId: string | null;
    km: number;
    actual: boolean;
    at: string;
  }>;
  towFare?: {
    estimate: number;
    ceiling: number;
    final?: number | null;
    partial?: boolean;
    deadheadKm: number;
    loadedKm: number;
    night: boolean;
    waitingFee?: number | null;
    vehicleClass?: string | null;
  } | null;
  cancelledBy?: string | null;
  towDistanceMeters?: number | null;
  etaPickupAt?: string | null;
  etaDropoffAt?: string | null;
  etaNotifiedAt?: string | null;
  linkedTicketIds?: string[];
  expiresAt?: string | null;
  suggestedShopId?: string | null;
  assignedUid?: string | null;
  assignedAt?: string | null;
  loadedAt?: string | null;
  towKind?: "NORMAL" | "RETURN" | null;
  deliveredAt?: string | null;
  deliveredBy?: string | null;
  receivedAt?: string | null;
  assignedShopId?: string | null;
  assignedKind?: string | null;
  formerAssignedShopIds?: string[];
  towCancelHistory?: Array<{
    shopId: string;
    by: string;
    at: string;
    reasonCode?: string;
  }>;
  candidates?: string[];
  candidateTs?: string | null;
  riderRating?: number | null; helperRating?: number | null;
  paymentDueAt?: string | null; paymentReminderCount?: number;
  paymentRemindedAt?: string | null;
  hold?: {
    reason: string;
    note?: string | null;
    etaAt?: string | null;
    by: string;
    at: string;
  } | null;
  loadedPhotos?: string[];
  receivedPhotos?: string[];
  riderLat?: number | null;
  riderLng?: number | null;
  riderSeenAt?: string | null;
  [key: string]: unknown;
}

const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

const create = async (data: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  note?: string;
  description?: string;
  photoUrls?: string[];
  declinedShopIds?: string[];
  pickupHistory?: Array<{lat: number; lng: number; at: string; reason: string}>;
  towerSearch?: string;
  needsNewDestination?: boolean;
  waiting?: {
    active: boolean;
    startedAt: string | null;
    endedAt: string | null;
    fee: number | null;
  } | null;
  towActual?: {
    quotedKm: number | null; actualKm: number | null; gpsKm?: number | null;
    cappedKm: number | null; distanceSource?: string | null;
  } | null;
  unfixable?: {
    reason: string;
    photoUrls: string[];
    by: string;
    at: string;
  } | null;
  unfixGraceAt?: string | null;
  providerId?: string;
  providerSnapshot?: Record<string, unknown>;
  destinationShopId?: string;
  destinationSnapshot?: Record<string, unknown>;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleId?: string | null;
  vehicleType?: string;
  vehicleWidth?: number;
  vehicleClass?: string;
  vehicleLabel?: string; vehiclePlate?: string; vehicleHeight?: number | null;
  towKind?: "NORMAL" | "RETURN";
  expiresAt?: string;
  sosAttempt?: number;
  continuedFromTicketId?: string | null;
  continuationTicketId?: string | null;
  excludedShopIds?: string[];
  excludedOperatorUids?: string[];
  sourceTicketId?: string | null;
  bookingId?: string | null;
  id?: string;
}): Promise<DispatchTicket> => {
  const ref = data.id !== undefined ?
    db.collection("dispatch_tickets").doc(data.id) :
    db.collection("dispatch_tickets").doc();
  const doc = {
    id: ref.id,
    userId: data.userId,
    ticketType: data.ticketType,
    lat: data.lat, lng: data.lng,
    note: orNull(data.note),
    description: orNull(data.description), photoUrls: data.photoUrls ?? [],
    declinedShopIds: data.declinedShopIds ?? [],
    pickupHistory: data.pickupHistory ?? [],
    towerSearch: data.towerSearch ?? "ACTIVE",
    needsNewDestination: data.needsNewDestination ?? false,
    waiting: data.waiting ?? null,
    towActual: data.towActual ?? null,
    unfixable: data.unfixable ?? null,
    sosAttempt: data.sosAttempt ?? 1,
    continuedFromTicketId: data.continuedFromTicketId ?? null,
    continuationTicketId: data.continuationTicketId ?? null,
    excludedShopIds: data.excludedShopIds ?? [],
    excludedOperatorUids: data.excludedOperatorUids ?? [],
    sourceTicketId: data.sourceTicketId ?? null,
    bookingId: data.bookingId ?? null,
    estimateAmount: null,
    estimateNote: null,
    estimateEta: null,
    estimateExpiresAt: null,
    estimateBy: null,
    estimatedAt: null,
    estimateApprovedAt: null,
    paymentArmed: null,
    quoteApprovedAt: null,
    faultPhotos: [],
    providerId: data.providerId ?? null,
    providerSnapshot: data.providerSnapshot ?? null,
    destinationShopId: data.destinationShopId ?? null,
    destinationSnapshot: data.destinationSnapshot ?? null,
    destinationPoint: data.destinationPoint ?? null,
    vehicleType: data.vehicleType ?? null,
    vehicleWidth: data.vehicleWidth ?? null,
    vehicleClass: data.vehicleClass ?? null,
    vehicleLabel: data.vehicleLabel ?? null,
    vehicleId: orNull(data.vehicleId),
    vehiclePlate: orNull(data.vehiclePlate),
    vehicleHeight: orNull(data.vehicleHeight),
    chatVersion: 0,
    chatHistory: [],
    workType: null,
    quoteItems: null,
    invoiceItems: null,
    quoteVersion: 0,
    invoiceAmount: null,
    invoiceApproval: null,
    invoiceVersion: 0,
    invoiceApprovedAt: null,
    quoteHistory: [],
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
    assignedAt: null,
    loadedAt: null,
    towKind: data.towKind ?? null,
    deliveredAt: null,
    deliveredBy: null,
    receivedAt: null,
    assignedShopId: null,
    assignedKind: null,
    candidates: [],
    candidateTs: null,
    riderRating: null,
    helperRating: null,
    status: STATUS_DISPATCH.PENDING,
    statusHistory: [{
      status: STATUS_DISPATCH.PENDING,
      at: new Date().toISOString(),
      by: data.userId,
    }],
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findByShareToken = async (
  token: string,
): Promise<DispatchTicket | null> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("shareToken", "==", token)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return {id: doc.id, ...doc.data()} as DispatchTicket;
};

const findById = async (id: string): Promise<DispatchTicket | null> => {
  const doc = await db.collection("dispatch_tickets").doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as DispatchTicket;
};

const updateStatus = async (
  id: string,
  status: string,
  byUserId?: string,
): Promise<void> => {
  const patch: Record<string, unknown> = {
    status,
    ...(TERMINAL_STATUSES.has(status) ? {hold: null} : {}),
  };
  if (byUserId !== undefined) {
    patch.statusHistory = FieldValue.arrayUnion({
      status,
      at: new Date().toISOString(),
      by: byUserId,
    });
  }
  await db.collection("dispatch_tickets").doc(id).update(patch);
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
  byUserId?: string,
): Promise<boolean> => {
  let claimed = false;
  await db.runTransaction(async (tx) => {
    const ref = db.collection("dispatch_tickets").doc(ticketId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    if (data.status !== STATUS_DISPATCH.PENDING) return;
    tx.update(ref, {
      ...fields,
      candidates: [],
      ...(byUserId !== undefined ?
        {
          statusHistory: FieldValue.arrayUnion({
            status: fields.status ?? STATUS_DISPATCH.MATCHED,
            at: new Date().toISOString(),
            by: byUserId,
          }),
        } :
        {}),
    });
    claimed = true;
  });
  return claimed;
};

const findAll = async (limit = 2000): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  return results;
};

const findDueForSla = async (
  nowIso: string,
  limit = 200,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("status", "==", STATUS_DISPATCH.PENDING)
    .where("acceptByAt", "<=", nowIso)
    .limit(limit)
    .get();
  const res: DispatchTicket[] = [];
  snap.forEach((doc) =>
    res.push({id: doc.id, ...doc.data()} as DispatchTicket));
  return res;
};

const findExpiredHolds = async (
  cutoffIso: string,
  limit = 200,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("hold.etaAt", "<=", cutoffIso)
    .limit(limit)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  return results;
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
  STATUS_DISPATCH.QUOTED,
  STATUS_DISPATCH.IN_SHOP,
  STATUS_DISPATCH.FINAL_QUOTED,
  STATUS_DISPATCH.ESTIMATED,
  STATUS_DISPATCH.EST_APPROVED,
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
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  results.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
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
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  results.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
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

const findActiveForDestination = async (
  shopId: string,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("destinationShopId", "==", shopId)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) => {
    const ticket = {id: doc.id, ...doc.data()} as DispatchTicket;
    if (
      ticket.status === STATUS_DISPATCH.PENDING ||
      ACTIVE_TICKET_STATUSES.has(ticket.status)
    ) {
      results.push(ticket);
    }
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
  results.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
  return results;
};

const findRecentForShop = async (
  shopId: string,
  limit = 20,
): Promise<DispatchTicket[]> => {
  const [assigned, addressed, former] = await Promise.all([
    db.collection("dispatch_tickets")
      .where("assignedShopId", "==", shopId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get(),
    db.collection("dispatch_tickets")
      .where("destinationShopId", "==", shopId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get(),
    db.collection("dispatch_tickets")
      .where("formerAssignedShopIds", "array-contains", shopId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get(),
  ]);
  const seen = new Set<string>();
  const results: DispatchTicket[] = [];
  for (const snap of [assigned, addressed, former]) {
    snap.forEach((doc) => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      results.push({id: doc.id, ...doc.data()} as DispatchTicket);
    });
  }
  results.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
  return results.slice(0, limit);
};

const findByIds = async (
  ids: string[],
): Promise<DispatchTicket[]> => {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) return [];
  const out: DispatchTicket[] = [];
  const CHUNK = 30;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection("dispatch_tickets").doc(id)),
    );
    for (const snap of snaps) {
      if (snap.exists) {
        out.push({id: snap.id, ...snap.data()} as DispatchTicket);
      }
    }
  }
  return out;
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

const appendJobTrack = async (
  ticketId: string,
  point: {lat: number; lng: number; at: string; shopId?: string | null},
): Promise<void> => {
  await db.collection("dispatch_tickets").doc(ticketId).update({
    jobTrack: FieldValue.arrayUnion(point),
  });
};

const countFulfilled = async (shopId: string): Promise<number> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("fulfilledByShopId", "==", shopId)
    .get();
  let done = 0;
  snap.forEach((doc) => {
    if (doc.data()?.status === STATUS_DISPATCH.RESOLVED) done += 1;
  });
  return done;
};
export {create, findById, findByShareToken, updateStatus, update,
  claimForAssignment, findDueForSla, findByStatus, findByStatusForTypes,
  findByUserId, findActiveForUid, findByAssignee, findActiveForShop,
  findActiveForDestination,
  findPendingForShop, findRecentForShop, findByIds,
  findStaleWalkIns, findExpiredHolds,
  appendJobTrack, countFulfilled,
  findBusyUids, findAll, ACTIVE_TICKET_STATUSES, DispatchTicket};
