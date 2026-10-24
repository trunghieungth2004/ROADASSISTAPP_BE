import * as chatRepository from "../repository/chatRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as flagRepository from "../repository/flagRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import * as fcmTokenRepository from "../repository/fcmTokenRepository";
import {messaging} from "../config/firebase";
import {CHAT_PHOTO_PREFIX} from "../constants/media";
import {TERMINAL_STATUSES} from "./dispatch/constants";
import {validatePhotoPaths} from "../utils/media";
import {ForbiddenError, NotFoundError, ValidationError} from "../utils/errors";
import type {Message} from "firebase-admin/messaging";

const MAX_TEXT = 1000;
const MAX_PHOTOS = 3;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Scope = "TICKET" | "HAZARD";

const flagExpiry = (flag: {ttlExpiresAt?: unknown}): string | null => {
  const value = flag.ttlExpiresAt;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const record = value as {toDate?: () => Date; _seconds?: number};
    if (typeof record.toDate === "function") {
      return record.toDate().toISOString();
    }
    if (typeof record._seconds === "number") {
      return new Date(record._seconds * 1000).toISOString();
    }
  }
  return null;
};

const ticketParticipants = async (
  ticketId: string,
): Promise<{ticket: dispatchRepository.DispatchTicket; uids: string[]}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const uids = [ticket.userId];
  if (typeof ticket.assignedUid === "string" &&
    ticket.assignedUid !== "") {
    uids.push(ticket.assignedUid);
  }
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (shopId !== "") {
    const shop = await providerRepository.findById(shopId);
    if (shop && typeof shop.operatorUid === "string") {
      uids.push(shop.operatorUid);
    }
  }
  return {ticket, uids: [...new Set(uids)]};
};

const pushChat = async (
  room: chatRepository.ChatRoom,
  senderUid: string,
  senderName: string | null,
  text: string | null,
): Promise<void> => {
  const recipients = room.participantUids.filter((uid) => uid !== senderUid);
  if (recipients.length === 0) return;
  const records = await fcmTokenRepository.findByUserIds(recipients);
  const messages: Array<{token: string; message: Message}> = [];
  for (const uid of recipients) {
    const tokens = (records.get(uid)?.tokens as string[] | undefined) ?? [];
    for (const token of tokens) {
      messages.push({
        token,
        message: {
          token,
          notification: {
            title: senderName ?? "Chat",
            body: text ?? "Photo",
          },
          data: {
            chatScope: room.scope,
            chatRefId: room.refId,
          },
        },
      });
    }
  }
  for (let i = 0; i < messages.length; i += 500) {
    try {
      await messaging.sendEach(
        messages.slice(i, i + 500).map((m) => m.message),
      );
    } catch {
      continue;
    }
  }
};

const open = async ({
  userId,
  scope,
  refId,
}: {
  userId: string;
  scope: Scope;
  refId: string;
}) => {
  if (scope === "TICKET") {
    const {ticket, uids} = await ticketParticipants(refId);
    if (!uids.includes(userId)) {
      throw new ForbiddenError("Only the rider and assigned provider chat");
    }
    const existing = await chatRepository.findById(
      chatRepository.roomIdFor(scope, refId),
    );
    if (existing) {
      if (existing.expiresAt && Date.parse(existing.expiresAt) <= Date.now()) {
        throw new ValidationError("Chat has expired");
      }
      return existing;
    }
    const expiresAt = TERMINAL_STATUSES.has(String(ticket.status)) ?
      new Date(Date.now() + RETENTION_MS).toISOString() :
      null;
    return chatRepository.create(scope, refId, uids, expiresAt);
  }
  const flag = await flagRepository.findById(refId);
  if (!flag) throw new NotFoundError("Hazard not found");
  const expiresAt = flagExpiry(flag);
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.now()) {
    throw new ValidationError("Hazard chat has expired");
  }
  const roomId = chatRepository.roomIdFor(scope, refId);
  const existing = await chatRepository.findById(roomId);
  if (existing) {
    if (!existing.participantUids.includes(userId)) {
      await chatRepository.addParticipant(roomId, userId);
    }
    return (await chatRepository.findById(roomId)) ?? existing;
  }
  return chatRepository.create(scope, refId, [userId], expiresAt);
};

const messages = async ({
  userId,
  scope,
  refId,
}: {
  userId: string;
  scope: Scope;
  refId: string;
}) => {
  const room = await open({userId, scope, refId});
  if (!room) throw new NotFoundError("Chat not found");
  if (room.expiresAt && Date.parse(room.expiresAt) <= Date.now()) {
    throw new ValidationError("Chat has expired");
  }
  return chatRepository.listMessages(room.id);
};

const send = async ({
  userId,
  scope,
  refId,
  text,
  photoUrls,
}: {
  userId: string;
  scope: Scope;
  refId: string;
  text?: string;
  photoUrls?: string[];
}) => {
  const body = typeof text === "string" ? text.trim() : "";
  if (body === "" && (!Array.isArray(photoUrls) || photoUrls.length === 0)) {
    throw new ValidationError("Message needs text or a photo");
  }
  if (body.length > MAX_TEXT) {
    throw new ValidationError("Message is too long");
  }
  if (Array.isArray(photoUrls) && photoUrls.length > MAX_PHOTOS) {
    throw new ValidationError("Too many photos");
  }
  const paths = validatePhotoPaths({
    paths: photoUrls,
    ownerUid: userId,
    prefix: CHAT_PHOTO_PREFIX,
  });
  const room = await open({userId, scope, refId});
  if (!room) throw new NotFoundError("Chat not found");
  if (room.expiresAt && Date.parse(room.expiresAt) <= Date.now()) {
    throw new ValidationError("Chat has expired");
  }
  if (scope === "TICKET") {
    const ticket = await dispatchRepository.findById(refId);
    if (!ticket) throw new NotFoundError("Dispatch ticket not found");
    if (TERMINAL_STATUSES.has(String(ticket.status)) &&
      !room.expiresAt) {
      await chatRepository.addParticipant(room.id, userId);
    }
    if (TERMINAL_STATUSES.has(String(ticket.status))) {
      throw new ValidationError("This ticket is closed");
    }
  }
  const user = await userRepository.findById(userId);
  const senderName = typeof user?.displayName === "string" ?
    user.displayName :
    null;
  const created = await chatRepository.addMessage(room.id, {
    senderUid: userId,
    senderName,
    text: body === "" ? null : body,
    photoUrls: paths,
    createdAt: new Date().toISOString(),
  });
  const fresh = await chatRepository.findById(room.id);
  if (fresh) await pushChat(fresh, userId, senderName, created.text);
  return created;
};

const expireChats = async (): Promise<{deleted: number}> => {
  const now = new Date().toISOString();
  const expired = await chatRepository.findExpired(now);
  let deleted = 0;
  for (const room of expired) {
    try {
      await chatRepository.deleteRoom(room.id);
      deleted += 1;
    } catch {
      continue;
    }
  }
  return {deleted};
};

export const chatService = {
  open,
  messages,
  send,
  expireChats,
};

export type ChatScope = Scope;
