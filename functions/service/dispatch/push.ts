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
} from "./constants";
import {STATUS_DISPATCH} from "../../constants/status";
import {findCandidates} from "./candidates";
import {fcmEnabled} from "../pushService";

export const deliverStatusPush = async (
  ticket: Record<string, unknown> & {id: string},
): Promise<{delivered: number; skipped: boolean}> => {
  let body = STATUS_PUSH_BODY[ticket.status as string];
  if (ticket.status === STATUS_DISPATCH.MATCHED) {
    body = MATCHED_BODY_BY_TYPE[ticket.ticketType as string] ?? body;
  }
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
  const title =
    PUSH_TITLE_BY_TYPE[ticket.ticketType as string] ?? "SOS update";
  let delivered = 0;
  for (let i = 0; i < tokens.length; i += SEND_CHUNK) {
    const chunk = tokens.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((token) => ({
        token,
        notification: {
          title,
          body,
        },
        data: {
          ticketId: ticket.id,
          ticketType: ticket.ticketType as string,
          status: ticket.status as string,
          ...(typeof ticket.declineReason === "string" &&
          ticket.declineReason !== "" ?
            {declineReason: ticket.declineReason} :
            {}),
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead: string[] = [];
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const token = chunk[idx];
        if (token !== undefined) dead.push(token);
      }
    });
    if (dead.length > 0 && typeof ticket.userId === "string") {
      await fcmTokenRepository.removeTokens(ticket.userId, dead);
    }
  }
  return {delivered, skipped: false};
};


export const deliverShopPush = async (
  ticket: Record<string, unknown> & {id: string},
  shopId: string,
): Promise<{delivered: number; skipped: boolean}> => {
  const shop = await providerRepository.findById(shopId);
  const operatorUid = shop?.operatorUid as string | null;
  if (!operatorUid) return {delivered: 0, skipped: true};
  const record = await fcmTokenRepository.findByUserId(operatorUid);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  if (tokens.length === 0) return {delivered: 0, skipped: true};
  let delivered = 0;
  for (let i = 0; i < tokens.length; i += SEND_CHUNK) {
    const chunk = tokens.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((token) => ({
        token,
        notification: {
          title: "Walk-in request",
          body: "A rider arrived at your shop — tap to review",
        },
        data: {
          ticketId: ticket.id,
          ticketType: ticket.ticketType as string,
          status: ticket.status as string,
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead: string[] = [];
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const token = chunk[idx];
        if (token !== undefined) dead.push(token);
      }
    });
    if (dead.length > 0) {
      await fcmTokenRepository.removeTokens(operatorUid, dead);
    }
  }
  return {delivered, skipped: false};
};


export const deliverOperatorPush = async (
  ticket: Record<string, unknown> & {id: string},
  notice?: {title: string; body: string},
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
  let delivered = 0;
  for (let i = 0; i < tokens.length; i += SEND_CHUNK) {
    const chunk = tokens.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((token) => ({
        token,
        notification: {
          title: notice?.title ?? "Ticket update",
          body: notice?.body ??
            "A ticket at your shop changed — tap to view",
        },
        data: {
          ticketId: ticket.id,
          ticketType: ticket.ticketType as string,
          status: ticket.status as string,
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead: string[] = [];
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const token = chunk[idx];
        if (token !== undefined) dead.push(token);
      }
    });
    if (dead.length > 0) {
      await fcmTokenRepository.removeTokens(operatorUid, dead);
    }
  }
  return {delivered, skipped: false};
};


export const deliverDispatchPush = async (
  ticketId: string,
  audience?: string,
  notice?: {title: string; body: string},
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {delivered: 0, skipped: true};
  if (audience === "operator") {
    return deliverOperatorPush(ticket, notice);
  }
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    return deliverStatusPush(ticket);
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
  const targets: Array<{userId: string; token: string}> = [];
  const records = await fcmTokenRepository.findByUserIds(candidates);
  for (const userId of candidates) {
    const tokens = (records.get(userId)?.tokens as string[] | undefined) ??
      [];
    for (const token of tokens) {
      targets.push({userId, token});
    }
  }
  let delivered = 0;
  for (let i = 0; i < targets.length; i += SEND_CHUNK) {
    const chunk = targets.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map(({token}) => ({
        token,
        notification: {
          title: "SOS request near you",
          body: `${ticket.ticketType} help needed — tap to view`,
        },
        data: {
          ticketId: ticket.id,
          ticketType: ticket.ticketType,
          lat: String(ticket.lat),
          lng: String(ticket.lng),
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead = new Map<string, string[]>();
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const {userId, token} = chunk[idx];
        dead.set(userId, [...(dead.get(userId) ?? []), token]);
      }
    });
    for (const [userId, tokens] of dead) {
      await fcmTokenRepository.removeTokens(userId, tokens);
    }
  }
  return {delivered, skipped: false};
};
