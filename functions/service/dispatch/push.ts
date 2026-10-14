import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import * as fcmTokenRepository from
  "../../repository/fcmTokenRepository";
import {messaging} from "../../config/firebase";
import {
  DEAD_TOKEN_CODES,
  DECLINE_REASON_LABEL,
  MATCHED_BODY_BY_TYPE,
  PUSH_TITLE_BY_TYPE,
  SEND_CHUNK,
  STATUS_PUSH_BODY,
  URGENT_DISPATCH_CHANNEL,
  DISPATCH_CHANNEL,
  URGENT_DISPATCH_STATUSES,
} from "./constants";
import {STATUS_DISPATCH} from "../../constants/status";
import {findCandidates, findTowOperators} from "./candidates";
import {fcmEnabled} from "../pushService";
import {logInfo} from "../../utils/logger";
import type {Message} from "firebase-admin/messaging";

type Notice = {title: string; body: string};

type AddressedMessage = {userId: string; token: string; message: Message};

const sendChunked = async (
  addressed: AddressedMessage[],
): Promise<number> => {
  let delivered = 0;
  const dead = new Map<string, string[]>();
  for (let i = 0; i < addressed.length; i += SEND_CHUNK) {
    const chunk = addressed.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((entry) => entry.message),
    );
    delivered += response.successCount ?? 0;
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const {userId, token} = chunk[idx];
        dead.set(userId, [...(dead.get(userId) ?? []), token]);
      }
    });
  }
  for (const [userId, tokens] of dead) {
    await fcmTokenRepository.removeTokens(userId, tokens);
  }
  return delivered;
};

const URGENT_TTL_MS = 3600_000;

const androidFor = (urgent: boolean, tag: string) => ({
  priority: (urgent ? "high" : "normal") as "high" | "normal",
  ...(urgent ? {ttl: URGENT_TTL_MS} : {}),
  notification: {
    ...(urgent ?
      {channelId: URGENT_DISPATCH_CHANNEL, sound: "default"} :
      {channelId: DISPATCH_CHANNEL}),
    tag,
  },
});

const statusIsUrgent = (status: unknown): boolean =>
  typeof status === "string" && URGENT_DISPATCH_STATUSES.has(status);

export const deliverStatusPush = async (
  ticket: Record<string, unknown> & {id: string},
  notice?: Notice,
  urgentOverride = false,
): Promise<{delivered: number; skipped: boolean}> => {
  const urgent = urgentOverride || statusIsUrgent(ticket.status);
  let body = notice?.body ??
    (ticket.status === STATUS_DISPATCH.MATCHED ?
      MATCHED_BODY_BY_TYPE[ticket.ticketType as string] :
      undefined) ??
    STATUS_PUSH_BODY[ticket.status as string];
  if (ticket.status === STATUS_DISPATCH.DECLINED &&
    typeof ticket.declineReason === "string") {
    const label = DECLINE_REASON_LABEL[ticket.declineReason] ?? "";
    if (label !== "") body = `${body} — ${label}`;
  }
  if (!body || typeof ticket.userId !== "string") {
    return {delivered: 0, skipped: true};
  }
  const record = await fcmTokenRepository.findByUserId(ticket.userId);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  const title = notice?.title ??
    PUSH_TITLE_BY_TYPE[ticket.ticketType as string] ?? "SOS update";
  const addressed: AddressedMessage[] = tokens.map((token) => ({
    userId: ticket.userId as string,
    token,
    message: {
      token,
      notification: {
        title,
        body,
      },
      android: androidFor(urgent, ticket.id),
      data: {
        ticketId: ticket.id,
        ticketType: ticket.ticketType as string,
        status: ticket.status as string,
        ...(urgent ? {urgent: "true"} : {}),
        ...(typeof ticket.declineReason === "string" &&
        ticket.declineReason !== "" ?
          {declineReason: ticket.declineReason} :
          {}),
      },
    } as Message,
  }));
  const delivered = await sendChunked(addressed);
  return {delivered, skipped: false};
};


export const deliverShopPush = async (
  ticket: Record<string, unknown> & {id: string},
  shopId: string,
  notice?: Notice,
  urgent = false,
): Promise<{delivered: number; skipped: boolean}> => {
  const shop = await providerRepository.findById(shopId);
  const operatorUid = shop?.operatorUid as string | null;
  if (!operatorUid) return {delivered: 0, skipped: true};
  if (shop?.accepting === false) return {delivered: 0, skipped: true};
  const record = await fcmTokenRepository.findByUserId(operatorUid);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  if (tokens.length === 0) return {delivered: 0, skipped: true};
  const addressed: AddressedMessage[] = tokens.map((token) => ({
    userId: operatorUid,
    token,
    message: {
      token,
      notification: {
        title: notice?.title ?? "Walk-in request",
        body: notice?.body ?? "A rider arrived at your shop — tap to review",
      },
      android: androidFor(urgent, ticket.id),
      data: {
        ticketId: ticket.id,
        ticketType: ticket.ticketType as string,
        status: ticket.status as string,
        ...(urgent ? {urgent: "true"} : {}),
      },
    } as Message,
  }));
  const delivered = await sendChunked(addressed);
  return {delivered, skipped: false};
};


export const deliverOperatorPush = async (
  ticket: Record<string, unknown> & {id: string},
  notice?: Notice,
  urgent = false,
): Promise<{delivered: number; skipped: boolean}> => {
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  let operatorUid: string | null = null;
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && typeof shop.operatorUid === "string") {
      operatorUid = shop.operatorUid;
      break;
    }
  }
  if (!operatorUid) return {delivered: 0, skipped: true};
  const record = await fcmTokenRepository.findByUserId(operatorUid);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  if (tokens.length === 0) return {delivered: 0, skipped: true};
  const addressed: AddressedMessage[] = tokens.map((token) => ({
    userId: operatorUid,
    token,
    message: {
      token,
      notification: {
        title: notice?.title ?? "Ticket update",
        body: notice?.body ??
          "A ticket at your shop changed — tap to view",
      },
      android: androidFor(urgent, ticket.id),
      data: {
        ticketId: ticket.id,
        ticketType: ticket.ticketType as string,
        status: ticket.status as string,
        ...(urgent ? {urgent: "true"} : {}),
      },
    } as Message,
  }));
  const delivered = await sendChunked(addressed);
  return {delivered, skipped: false};
};


export const fanOutToCandidates = async (
  ticket: Record<string, unknown> & {id: string},
  candidates: string[],
  title: string,
  body: string,
): Promise<{delivered: number; skipped: boolean}> => {
  const addressed: AddressedMessage[] = [];
  const records = await fcmTokenRepository.findByUserIds(candidates);
  for (const userId of candidates) {
    const tokens = (records.get(userId)?.tokens as string[] | undefined) ??
      [];
    for (const token of tokens) {
      addressed.push({
        userId,
        token,
        message: {
          token,
          notification: {title, body},
          android: androidFor(false, ticket.id),
          data: {
            ticketId: ticket.id,
            ticketType: ticket.ticketType as string,
            lat: String(ticket.lat),
            lng: String(ticket.lng),
          },
        } as Message,
      });
    }
  }
  const delivered = await sendChunked(addressed);
  return {delivered, skipped: false};
};

export const deliverTowWithdrawn = async (
  ticketId: string,
  notice?: Notice,
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {delivered: 0, skipped: true};
  let candidates = (ticket.candidates as string[] | undefined) ?? [];
  if (candidates.length === 0 && ticket.ticketType === "TOW") {
    candidates = await findTowOperators({
      lat: ticket.lat,
      lng: ticket.lng,
      vehicleType: ticket.vehicleType as string | undefined,
    });
  }
  if (candidates.length === 0) return {delivered: 0, skipped: true};
  return fanOutToCandidates(
    ticket as Record<string, unknown> & {id: string},
    candidates,
    notice?.title ?? "Tow request withdrawn",
    notice?.body ?? "A tow request near you was cancelled",
  );
};

export const deliverDispatchPush = async (
  ticketId: string,
  audience?: string,
  notice?: Notice,
  shopId?: string,
  urgent = false,
): Promise<{delivered: number; skipped: boolean}> => {
  const result = await deliverDispatchPushInner(
    ticketId,
    audience,
    notice,
    shopId,
    urgent,
  );
  logInfo("push", "dispatch delivered", {
    ticketId,
    audience: audience ?? "status-blind",
    urgent,
    delivered: result.delivered,
    skipped: result.skipped,
  });
  return result;
};

const deliverDispatchPushInner = async (
  ticketId: string,
  audience?: string,
  notice?: Notice,
  shopId?: string,
  urgent = false,
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {delivered: 0, skipped: true};
  if (audience === "operator") {
    return deliverOperatorPush(ticket, notice, urgent);
  }
  if (audience === "rider") {
    return deliverStatusPush(ticket, notice, urgent);
  }
  if (audience === "tower-candidates") {
    return deliverTowWithdrawn(ticketId, notice);
  }
  if (audience === "destination-shop") {
    const target = typeof shopId === "string" && shopId !== "" ?
      shopId :
      typeof ticket.destinationShopId === "string" ?
        ticket.destinationShopId :
        "";
    if (target === "") return {delivered: 0, skipped: true};
    return deliverShopPush(ticket, target, notice, urgent);
  }
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    return deliverStatusPush(ticket, notice);
  }
  if (ticket.ticketType === "WALK_IN" &&
    typeof ticket.providerId === "string" && ticket.providerId !== "") {
    return deliverShopPush(ticket, ticket.providerId as string);
  }
  let candidates = (ticket.candidates as string[] | undefined) ?? [];
  if (candidates.length === 0 && ticket.ticketType === "SOS") {
    candidates = await findCandidates({
      lat: ticket.lat,
      lng: ticket.lng,
      vehicleType: ticket.vehicleType as string | undefined,
    });
  }
  if (candidates.length === 0 && ticket.ticketType === "TOW") {
    candidates = await findTowOperators({
      lat: ticket.lat,
      lng: ticket.lng,
      vehicleType: ticket.vehicleType as string | undefined,
    });
  }
  if (candidates.length === 0) return {delivered: 0, skipped: true};
  return fanOutToCandidates(
    ticket as Record<string, unknown> & {id: string},
    candidates,
    ticket.ticketType === "TOW" ?
      "Tow request near you" :
      "SOS request near you",
    `${ticket.ticketType} help needed — tap to view`,
  );
};
