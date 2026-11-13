import * as dispatchRepository from "../repository/dispatchRepository";
import * as providerRepository from "../repository/providerRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as userRepository from "../repository/userRepository";
import * as warrantyRepository from "../repository/warrantyRepository";
import * as refundService from "./refundService";
import {createDispatch} from "./dispatch/tickets";
import {chatService} from "./chatService";
import {enqueueDispatchPush} from "./taskQueueService";
import {STATUS_DISPATCH} from "../constants/status";
import {PAYMENT_RECEIVED_STATUSES} from "../constants/payments";
import {ROLE_ADMIN} from "../constants/roles";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import {TERMINAL_STATUSES} from "../constants/dispatch";
import {
  WARRANTY_DECLINE_LABEL,
  WARRANTY_DECLINE_REASON,
} from "../constants/warranty";
import {validatePhotoPathsStructure} from "../utils/media";
import {deliverAdminPush} from "./push/admin";
import * as auditService from "./auditService";

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const lineOf = (
  ticket: dispatchRepository.DispatchTicket,
  lineId: string,
): Record<string, unknown> | null => {
  const items = Array.isArray(ticket.invoiceItems) &&
    ticket.invoiceItems.length > 0 ?
    ticket.invoiceItems :
    Array.isArray(ticket.quoteItems) ? ticket.quoteItems : [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (str(row.lineId) === lineId) return row;
  }
  return null;
};

const providerSnapshot = (
  provider: providerRepository.Provider,
): Record<string, unknown> => ({
  id: provider.id,
  kind: provider.kind,
  name: provider.name,
  lat: provider.lat,
  lng: provider.lng,
  label: provider.label ?? null,
  status: provider.status,
  accepting: provider.accepting !== false,
  openHours: provider.openHours ?? null,
  vehicleClasses: provider.vehicleClasses ?? null,
  ratingAvg: provider.ratingAvg ?? 0,
  ratingCount: provider.ratingCount ?? 0,
  services: provider.services ?? null,
  serviceFee: provider.serviceFee ?? null,
  towBaseFee: provider.towBaseFee ?? null,
  towPerKmFee: provider.towPerKmFee ?? null,
  callOutFee: provider.callOutFee ?? null,
  travelPerKmFee: provider.travelPerKmFee ?? null,
});

const enrichClaims = async (
  claims: warrantyRepository.WarrantyClaim[],
): Promise<
  Array<warrantyRepository.WarrantyClaim & Record<string, unknown>>
> => {
  const providerCache = new Map<string, Record<string, unknown> | null>();
  const ticketCache =
    new Map<string, dispatchRepository.DispatchTicket | null>();
  const providerFor = async (
    id: string,
  ): Promise<Record<string, unknown> | null> => {
    if (providerCache.has(id)) return providerCache.get(id) ?? null;
    const provider = await providerRepository.findById(id)
      .catch(() => null);
    const snapshot = provider === null ? null : providerSnapshot(provider);
    providerCache.set(id, snapshot);
    return snapshot;
  };
  const ticketFor = async (
    id: string,
  ): Promise<dispatchRepository.DispatchTicket | null> => {
    if (ticketCache.has(id)) return ticketCache.get(id) ?? null;
    const ticket = await dispatchRepository.findById(id).catch(() => null);
    ticketCache.set(id, ticket);
    return ticket;
  };
  return Promise.all(claims.map(async (claim) => {
    const provider = await providerFor(claim.providerId);
    const ticket = await ticketFor(claim.ticketId);
    const line = ticket === null ? null : lineOf(ticket, claim.lineId);
    return {
      ...claim,
      ...(provider !== null ? {
        provider,
        providerName: provider.name,
      } : {}),
      ...(ticket !== null ? {
        ticketType: ticket.ticketType,
        ticketStatus: ticket.status,
        serviceDate: typeof ticket.deliveredAt === "string" ?
          ticket.deliveredAt :
          typeof ticket.createdAt === "string" ? ticket.createdAt : null,
      } : {}),
      ...(line !== null ? {
        qty: typeof line.qty === "number" ? line.qty : null,
        unitPrice: typeof line.unitPrice === "number" ? line.unitPrice : null,
        warrantyDays: typeof line.warrantyDays === "number" ?
          line.warrantyDays :
          null,
        warrantyParts: typeof line.warrantyParts === "string" ?
          line.warrantyParts :
          null,
        category: claim.category ??
          (typeof line.category === "string" ? line.category : null),
      } : {}),
    };
  }));
};

const fileClaim = async ({
  userId,
  ticketId,
  lineId,
  reason,
  photoUrls,
}: {
  userId: string;
  ticketId: string;
  lineId: string;
  reason: string;
  photoUrls?: string[];
}): Promise<warrantyRepository.WarrantyClaim> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider claims warranty");
  }
  if (ticket.status !== STATUS_DISPATCH.RESOLVED) {
    throw new ValidationError("Warranty starts after the job is resolved");
  }
  const line = lineOf(ticket, lineId);
  if (!line) throw new NotFoundError("Service line not found");
  if (line.kind !== "SERVICE") {
    throw new ValidationError("Only catalog services carry warranty");
  }
  const until = str(line.warrantyUntil);
  if (until === "" || Date.parse(until) < Date.now()) {
    throw new ValidationError("Warranty for this service has expired");
  }
  const reasonText = str(reason);
  if (reasonText.length < 5 || reasonText.length > 280) {
    throw new ValidationError("Warranty reason is invalid");
  }
  const photos = Array.isArray(photoUrls) ? photoUrls : [];
  validatePhotoPathsStructure(photos);
  const providerId = str(ticket.assignedShopId) || str(ticket.providerId);
  if (providerId === "") {
    throw new ValidationError("Ticket has no provider");
  }
  const existing = await warrantyRepository.findByLine(lineId);
  if (existing.length > 0) {
    throw new ValidationError(
      "A warranty claim already exists for this service",
    );
  }
  const claim = await warrantyRepository.create({
    ticketId,
    lineId,
    serviceCode: str(line.serviceCode),
    serviceName: str(line.name),
    category: str(line.category) || null,
    riderUid: userId,
    providerId,
    vehicleId: typeof ticket.vehicleId === "string" ?
      ticket.vehicleId : null,
    vehicleLabel: typeof ticket.vehicleLabel === "string" ?
      ticket.vehicleLabel : null,
    vehiclePlate: typeof ticket.vehiclePlate === "string" ?
      ticket.vehiclePlate : null,
    lineAmount: typeof line.amount === "number" ? line.amount : 0,
    purchasedAt: typeof ticket.deliveredAt === "string" ?
      ticket.deliveredAt :
      typeof ticket.createdAt === "string" ? ticket.createdAt : null,
    warrantyUntil: until,
    reason: reasonText,
    photoUrls: photos,
  });
  await enqueueDispatchPush(ticketId, `-warranty-${claim.id}`, {
    audience: "destination-shop",
    shopId: providerId,
    title: "Warranty claim",
    body: `${claim.serviceName}: ${reasonText}`,
  }).catch(() => undefined);
  await deliverAdminPush({
    event: "WARRANTY_CLAIM",
    title: "New warranty claim",
    body: `${claim.serviceName}: ${reasonText}`,
    refId: claim.id,
    route: "/admin?section=warranty",
  }).catch(() => undefined);
  return claim;
};

const myClaims = async ({
  userId,
  limit,
}: {
  userId: string;
  limit?: number;
}) => {
  const claims = await warrantyRepository.findByRider(
    userId,
    Math.min(limit ?? 50, 100),
  );
  return enrichClaims(claims);
};

const respond = async ({
  userId,
  claimId,
  accept,
  reasonCode,
  note,
}: {
  userId: string;
  claimId: string;
  accept: boolean;
  reasonCode?: string;
  note?: string;
}): Promise<warrantyRepository.WarrantyClaim> => {
  const claim = await warrantyRepository.findById(claimId);
  if (!claim) throw new NotFoundError("Warranty claim not found");
  if (claim.status !== warrantyRepository.WARRANTY_STATUS.OPEN) {
    throw new ValidationError("Warranty claim is already decided");
  }
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const shop = await providerRepository.findById(claim.providerId);
  if (shop?.operatorUid !== userId) {
    throw new ForbiddenError("Only the provider answers the claim");
  }
  const response = str(note);
  const now = new Date().toISOString();
  if (!accept) {
    const code = str(reasonCode);
    if (!(Object.values(WARRANTY_DECLINE_REASON) as string[]).includes(code)) {
      throw new ValidationError("Warranty decline reason is required");
    }
    if (response.length < 5) {
      throw new ValidationError("Warranty decline note is required");
    }
    const label = WARRANTY_DECLINE_LABEL[code] ?? code;
    await warrantyRepository.update(claimId, {
      status: warrantyRepository.WARRANTY_STATUS.DECLINED,
      shopResponse: response,
      declineReasonCode: code,
      respondedAt: now,
    });
    await chatService.addSystemEvent(
      claim.ticketId,
      `The shop declined the warranty claim: ${label} · ${response}`,
      "WARRANTY_DECLINED",
      {claimId, reasonCode: code, note: response},
    ).catch(() => undefined);
    await enqueueDispatchPush(
      claim.ticketId,
      `-warranty-declined-${claimId}`,
      {
        audience: "rider",
        title: "Warranty declined",
        body: `${claim.serviceName}: ${label} · ${response}`,
      },
    ).catch(() => undefined);
    const updated = await warrantyRepository.findById(claimId);
    return updated ?? claim;
  }
  const original = await dispatchRepository.findById(claim.ticketId);
  if (!original) throw new NotFoundError("Original ticket not found");
  const rework = await createDispatch({
    userId: claim.riderUid,
    ticketType: "WALK_IN",
    lat: Number(original.lat ?? 0),
    lng: Number(original.lng ?? 0),
    providerId: claim.providerId,
    note: `Warranty rework: ${claim.serviceName}`,
    allowOffDutyShop: true,
    allowMissingVehicle: true,
  });
  await dispatchRepository.update(rework.id, {
    warrantyOfTicketId: claim.ticketId,
    warrantyClaimId: claimId,
  });
  await warrantyRepository.update(claimId, {
    status: warrantyRepository.WARRANTY_STATUS.REBOOKED,
    shopResponse: response || null,
    declineReasonCode: null,
    respondedAt: now,
    linkedTicketId: rework.id,
  });
  await chatService.addSystemEvent(
    claim.ticketId,
    "The shop accepted the warranty claim.",
    "WARRANTY_ACCEPTED",
    {claimId},
  ).catch(() => undefined);
  await enqueueDispatchPush(
    claim.ticketId,
    `-warranty-accepted-${claimId}`,
    {
      audience: "rider",
      title: "Warranty accepted",
      body: `${claim.serviceName}: rework booked`,
    },
  ).catch(() => undefined);
  const updated = await warrantyRepository.findById(claimId);
  return updated ?? claim;
};

const dispute = async ({
  userId,
  claimId,
  note,
}: {
  userId: string;
  claimId: string;
  note?: string;
}): Promise<warrantyRepository.WarrantyClaim> => {
  const claim = await warrantyRepository.findById(claimId);
  if (!claim) throw new NotFoundError("Warranty claim not found");
  if (claim.riderUid !== userId) {
    throw new ForbiddenError("Only the rider disputes the claim");
  }
  if (claim.status !== warrantyRepository.WARRANTY_STATUS.DECLINED) {
    throw new ValidationError("Only a declined claim can be disputed");
  }
  const disputeNote = str(note);
  if (disputeNote.length < 5) {
    throw new ValidationError("Warranty dispute note is required");
  }
  await warrantyRepository.update(claimId, {
    status: warrantyRepository.WARRANTY_STATUS.DISPUTED,
    disputeNote,
    disputedAt: new Date().toISOString(),
  });
  await deliverAdminPush({
    event: "WARRANTY_DISPUTED",
    title: "Warranty disputed",
    body: `${claim.serviceName}: ${disputeNote}`,
    refId: claimId,
    route: "/admin?section=warranty",
  }).catch(() => undefined);
  const updated = await warrantyRepository.findById(claimId);
  return updated ?? claim;
};

const shopClaims = async ({
  userId,
  providerId,
  limit,
}: {
  userId: string;
  providerId?: string;
  limit?: number;
}): Promise<warrantyRepository.WarrantyClaim[]> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const providers = await providerRepository.findByOperator(userId);
  const ids = providerId !== undefined && providerId !== "" ?
    [providerId] :
    providers.map((provider) => provider.id);
  const capped = Math.min(limit ?? 100, 200);
  const rows: warrantyRepository.WarrantyClaim[] = [];
  for (const id of ids) {
    rows.push(...await warrantyRepository.findByProvider(id, capped));
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return enrichClaims(rows.slice(0, capped));
};

const listClaims = async ({
  adminUid,
  status,
  limit,
}: {
  adminUid: string;
  status?: string;
  limit?: number;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller || caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin only");
  }
  const capped = Math.min(limit ?? 100, 200);
  if (status === undefined || status === "") {
    return warrantyRepository.findAll(capped);
  }
  return warrantyRepository.findByStatus(status, capped);
};

const reworkSettled = async (
  claim: warrantyRepository.WarrantyClaim,
): Promise<boolean> => {
  const linkedTicketId = str(claim.linkedTicketId);
  if (linkedTicketId === "") return true;
  const ticket = await dispatchRepository.findById(linkedTicketId);
  if (!ticket) return true;
  return TERMINAL_STATUSES.has(str(ticket.status));
};

const resolve = async ({
  adminUid,
  claimId,
  outcome,
  refundAmount,
  note,
}: {
  adminUid: string;
  claimId: string;
  outcome: "SHOP" | "RIDER" | "PARTIAL";
  refundAmount?: number;
  note?: string;
}): Promise<warrantyRepository.WarrantyClaim> => {
  const caller = await userRepository.findById(adminUid);
  if (!caller || caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin only");
  }
  const claim = await warrantyRepository.findById(claimId);
  if (!claim) throw new NotFoundError("Warranty claim not found");
  const resolvable: string[] = [
    warrantyRepository.WARRANTY_STATUS.DECLINED,
    warrantyRepository.WARRANTY_STATUS.DISPUTED,
    warrantyRepository.WARRANTY_STATUS.OPEN,
  ];
  const rebookedSettled = claim.status ===
    warrantyRepository.WARRANTY_STATUS.REBOOKED ?
    await reworkSettled(claim) :
    false;
  if (!resolvable.includes(claim.status) && !rebookedSettled) {
    throw new ValidationError("Warranty claim cannot be resolved");
  }
  let refundRequestId: string | null = null;
  let refunded = 0;
  if (outcome !== "SHOP") {
    const amount = outcome === "PARTIAL" ?
      refundAmount :
      claim.lineAmount;
    if (typeof amount !== "number" || !Number.isInteger(amount) ||
      amount <= 0 || amount > claim.lineAmount) {
      throw new ValidationError("Refund amount is invalid");
    }
    const payments = await paymentRepository.findByTicketId(claim.ticketId);
    const payment = payments.find((row) =>
      PAYMENT_RECEIVED_STATUSES.includes(row.status));
    if (!payment) throw new ValidationError("No received payment to refund");
    const request = await refundService.requestRefund({
      paymentId: payment.id,
      requestedBy: adminUid,
      amount,
      automatic: false,
      reason: "Warranty claim",
    });
    refundRequestId = request.id;
    refunded = amount;
  }
  await warrantyRepository.update(claimId, {
    status: warrantyRepository.WARRANTY_STATUS.RESOLVED,
    outcome,
    ...(refunded > 0 ? {refundAmount: refunded} : {}),
    refundRequestId,
    resolvedBy: adminUid,
    resolvedAt: new Date().toISOString(),
    resolutionNote: str(note) || null,
  });
  await chatService.addSystemEvent(
    claim.ticketId,
    `Warranty claim resolved: ${outcome}.`,
    "WARRANTY_RESOLVED",
    {claimId, outcome},
  ).catch(() => undefined);
  await enqueueDispatchPush(
    claim.ticketId,
    `-warranty-resolved-${claimId}`,
    {
      audience: "rider",
      title: "Warranty resolved",
      body: `${claim.serviceName}: ${outcome}`,
    },
  ).catch(() => undefined);
  const updated = await warrantyRepository.findById(claimId);
  await auditService.record({
    adminUid,
    action: "WARRANTY_DECIDED",
    category: "CONTENT",
    targetType: "WARRANTY",
    targetId: claimId,
    targetLabel: claim.serviceName,
    before: {status: claim.status},
    after: {
      status: warrantyRepository.WARRANTY_STATUS.RESOLVED,
      outcome,
      ...(refunded > 0 ? {refundAmount: refunded} : {}),
    },
    note: note ?? null,
    meta: {ticketId: claim.ticketId, refundRequestId},
  });
  return updated ?? claim;
};

const sweepWarrantyRebooks = async (): Promise<{
  completed: number;
  reopened: number;
}> => {
  const claims = await warrantyRepository.findByStatus(
    warrantyRepository.WARRANTY_STATUS.REBOOKED,
    200,
  );
  let completed = 0;
  let reopened = 0;
  for (const claim of claims) {
    const linkedTicketId = str(claim.linkedTicketId);
    if (linkedTicketId === "") {
      await reopenClaim(claim);
      reopened += 1;
      continue;
    }
    const ticket = await dispatchRepository.findById(linkedTicketId);
    if (!ticket) {
      await reopenClaim(claim);
      reopened += 1;
      continue;
    }
    if (str(ticket.status) === STATUS_DISPATCH.RESOLVED) {
      await warrantyRepository.update(claim.id, {
        status: warrantyRepository.WARRANTY_STATUS.COMPLETED,
        resolvedAt: new Date().toISOString(),
      }).catch(() => undefined);
      completed += 1;
      continue;
    }
    if (TERMINAL_STATUSES.has(str(ticket.status))) {
      await reopenClaim(claim);
      reopened += 1;
    }
  }
  return {completed, reopened};
};

const reopenClaim = async (
  claim: warrantyRepository.WarrantyClaim,
): Promise<void> => {
  await warrantyRepository.update(claim.id, {
    status: warrantyRepository.WARRANTY_STATUS.OPEN,
    linkedTicketId: null,
  }).catch(() => undefined);
  await chatService.addSystemEvent(
    claim.ticketId,
    "The warranty rework was cancelled — the claim is open again.",
    "WARRANTY_REOPENED",
    {claimId: claim.id},
  ).catch(() => undefined);
  await enqueueDispatchPush(
    claim.ticketId,
    `-warranty-reopened-${claim.id}`,
    {
      audience: "destination-shop",
      shopId: claim.providerId,
      title: "Warranty claim reopened",
      body: `${claim.serviceName}: rework was cancelled`,
    },
  ).catch(() => undefined);
};

const completeForTicket = async (ticketId: string): Promise<void> => {
  const claim = await warrantyRepository.findByLinkedTicket(ticketId);
  if (!claim) return;
  if (claim.status !== warrantyRepository.WARRANTY_STATUS.REBOOKED) return;
  await warrantyRepository.update(claim.id, {
    status: warrantyRepository.WARRANTY_STATUS.COMPLETED,
    resolvedAt: new Date().toISOString(),
  }).catch(() => undefined);
};

export {
  fileClaim,
  myClaims,
  shopClaims,
  respond,
  dispute,
  listClaims,
  resolve,
  completeForTicket,
  sweepWarrantyRebooks,
};
