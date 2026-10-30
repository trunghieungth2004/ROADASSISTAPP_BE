import {db, FieldValue} from "../config/firebase";

export type ChatRoom = {
  id: string;
  scope: string;
  refId: string;
  version: number;
  participantUids: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  closedAt: string | null;
};

export type ChatMessage = {
  id: string;
  senderUid: string;
  senderName: string | null;
  text: string | null;
  photoUrls: string[];
  kind?: string;
  event?: string;
  params?: Record<string, string | number>;
  createdAt: string;
};

const roomIdFor = (
  scope: string,
  refId: string,
  version = 0,
): string => {
  const suffix = version > 0 ? `_v${version}` : "";
  return `${scope.toLowerCase()}_${refId}${suffix}`;
};

const findById = async (roomId: string): Promise<ChatRoom | null> => {
  const doc = await db.collection("chats").doc(roomId).get();
  if (!doc.exists) return null;
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    ...data,
    version: typeof data.version === "number" ? data.version : 0,
  } as ChatRoom;
};

const create = async (
  scope: string,
  refId: string,
  participantUids: string[],
  expiresAt: string | null,
  version = 0,
): Promise<ChatRoom> => {
  const id = roomIdFor(scope, refId, version);
  const now = new Date().toISOString();
  const doc = {
    scope,
    refId,
    version,
    participantUids: [...new Set(participantUids)],
    createdAt: now,
    updatedAt: now,
    expiresAt,
    closedAt: null,
  };
  await db.collection("chats").doc(id).set(doc);
  return {id, ...doc};
};

const clearExpiry = async (roomId: string): Promise<void> => {
  await db.collection("chats").doc(roomId).update({
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  });
};

const archiveRoom = async (roomId: string, at: string): Promise<void> => {
  await db.collection("chats").doc(roomId).update({
    closedAt: at,
    updatedAt: at,
  });
};

const addParticipant = async (
  roomId: string,
  uid: string,
): Promise<void> => {
  await db.collection("chats").doc(roomId).update({
    participantUids: FieldValue.arrayUnion(uid),
    updatedAt: new Date().toISOString(),
  });
};

const addMessage = async (
  roomId: string,
  message: Omit<ChatMessage, "id">,
): Promise<ChatMessage> => {
  const ref = db.collection("chats").doc(roomId).collection("messages").doc();
  const doc = {...message, id: ref.id};
  await ref.set(doc);
  await db.collection("chats").doc(roomId).update({
    updatedAt: message.createdAt,
  });
  return doc;
};

const listMessages = async (
  roomId: string,
  limit = 100,
): Promise<ChatMessage[]> => {
  const snapshot = await db
    .collection("chats")
    .doc(roomId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();
  const rows: ChatMessage[] = [];
  snapshot.forEach((doc) => rows.push(doc.data() as ChatMessage));
  return rows;
};

const deleteRoom = async (roomId: string): Promise<void> => {
  const messages = await db
    .collection("chats")
    .doc(roomId)
    .collection("messages")
    .get();
  const batch = db.batch();
  messages.forEach((doc) => batch.delete(doc.ref));
  batch.delete(db.collection("chats").doc(roomId));
  await batch.commit();
};

const findExpired = async (nowIso: string): Promise<ChatRoom[]> => {
  const snapshot = await db
    .collection("chats")
    .where("scope", "==", "HAZARD")
    .where("expiresAt", "<=", nowIso)
    .limit(50)
    .get();
  const rows: ChatRoom[] = [];
  snapshot.forEach((doc) => rows.push({id: doc.id, ...doc.data()} as ChatRoom));
  return rows;
};

export {
  roomIdFor,
  findById,
  create,
  addParticipant,
  clearExpiry,
  archiveRoom,
  addMessage,
  listMessages,
  deleteRoom,
  findExpired,
};
