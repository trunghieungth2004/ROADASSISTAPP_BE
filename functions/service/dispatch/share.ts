import {randomBytes} from "crypto";
import * as dispatchRepository from "../../repository/dispatchRepository";
import * as providerRepository from "../../repository/providerRepository";
import {TERMINAL_STATUSES} from "./constants";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors";

const SHARE_TTL_MS = 6 * 60 * 60 * 1000;

const statusOf = (ticket: dispatchRepository.DispatchTicket): string =>
  String(ticket.status ?? "");

const lastUpdated = (
  ticket: dispatchRepository.DispatchTicket,
): string | null => {
  const history = Array.isArray(ticket.statusHistory) ?
    ticket.statusHistory :
    [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (typeof row !== "object" || row === null) continue;
    const at = (row as {at?: unknown}).at;
    if (typeof at === "string" && at !== "") return at;
  }
  return typeof ticket.createdAt === "string" ? ticket.createdAt : null;
};

const createShareLink = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}): Promise<{token: string; expiresAt: string}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider shares this ticket");
  }
  if (TERMINAL_STATUSES.has(statusOf(ticket))) {
    throw new ValidationError("Closed tickets cannot be shared live");
  }
  const token = randomBytes(18).toString("hex");
  const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
  await dispatchRepository.update(ticketId, {
    shareToken: token,
    shareExpiresAt: expiresAt,
  });
  return {token, expiresAt};
};

const revokeShareLink = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}): Promise<{revoked: boolean}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider revokes this link");
  }
  await dispatchRepository.update(ticketId, {
    shareToken: null,
    shareExpiresAt: null,
  });
  return {revoked: true};
};

const RIDER_FRESH_MS = 2 * 60 * 1000;

const recordRiderBeat = async ({
  userId,
  ticketId,
  lat,
  lng,
}: {
  userId: string;
  ticketId: string;
  lat: number;
  lng: number;
}): Promise<{recorded: boolean}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider shares live location");
  }
  if (TERMINAL_STATUSES.has(statusOf(ticket))) {
    throw new ValidationError("Closed tickets cannot be shared live");
  }
  if (typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ValidationError("Invalid location");
  }
  await dispatchRepository.update(ticketId, {
    riderLat: lat,
    riderLng: lng,
    riderSeenAt: new Date().toISOString(),
  });
  return {recorded: true};
};

const viewShareLink = async ({
  token,
}: {
  token: string;
}): Promise<{
  ticketId: string;
  ticketType: string;
  status: string;
  lat: number;
  lng: number;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string;
  providerName: string | null;
  etaPickupAt: string | null;
  etaDropoffAt: string | null;
}> => {
  const ticket = await dispatchRepository.findByShareToken(token);
  if (!ticket) throw new NotFoundError("Tracking link not found");
  const expiresAt = typeof ticket.shareExpiresAt === "string" ?
    ticket.shareExpiresAt :
    "";
  if (expiresAt === "" || Date.parse(expiresAt) < Date.now()) {
    throw new NotFoundError("Tracking link has expired");
  }
  const providerId = typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" ?
    ticket.assignedShopId :
    typeof ticket.providerId === "string" ? ticket.providerId : "";
  const provider = providerId === "" ?
    null :
    await providerRepository.findById(providerId);
  const riderSeen = typeof ticket.riderSeenAt === "string" ?
    Date.parse(ticket.riderSeenAt) :
    0;
  const riderFresh = Number.isFinite(riderSeen) &&
    Date.now() - riderSeen <= RIDER_FRESH_MS;
  return {
    ticketId: ticket.id,
    ticketType: String(ticket.ticketType ?? ""),
    status: statusOf(ticket),
    lat: riderFresh && typeof ticket.riderLat === "number" ?
      ticket.riderLat :
      typeof ticket.lat === "number" ? ticket.lat : 0,
    lng: riderFresh && typeof ticket.riderLng === "number" ?
      ticket.riderLng :
      typeof ticket.lng === "number" ? ticket.lng : 0,
    createdAt: typeof ticket.createdAt === "string" ? ticket.createdAt : null,
    updatedAt: lastUpdated(ticket),
    expiresAt,
    providerName: provider && typeof provider.name === "string" ?
      provider.name :
      null,
    etaPickupAt: typeof ticket.etaPickupAt === "string" ?
      ticket.etaPickupAt :
      null,
    etaDropoffAt: typeof ticket.etaDropoffAt === "string" ?
      ticket.etaDropoffAt :
      null,
  };
};

export {
  createShareLink,
  revokeShareLink,
  viewShareLink,
  recordRiderBeat,
  SHARE_TTL_MS,
};
