import {db} from "../config/firebase";

interface PushTokenRecord {
  userId: string;
  tokens: string[];
  updatedAt: string;
  [key: string]: unknown;
}

const MAX_TOKENS = 10;
const COLLECTION = "push_tokens";
const LEGACY_COLLECTION = "admin_push_tokens";

const toRecord = (
  userId: string,
  data: Record<string, unknown>,
): PushTokenRecord => ({userId, ...data} as PushTokenRecord);

const migrateLegacy = async (
  userId: string,
  data: Record<string, unknown>,
): Promise<PushTokenRecord> => {
  const record = toRecord(userId, data);
  await db.collection(COLLECTION).doc(userId).set(record);
  await db.collection(LEGACY_COLLECTION).doc(userId).delete();
  return record;
};

const findByUserId = async (
  userId: string,
): Promise<PushTokenRecord | null> => {
  const doc = await db.collection(COLLECTION).doc(userId).get();
  if (doc.exists) {
    return toRecord(doc.id, doc.data() ?? {});
  }
  const legacy = await db.collection(LEGACY_COLLECTION).doc(userId).get();
  if (!legacy.exists) return null;
  return migrateLegacy(userId, legacy.data() ?? {});
};

const findByUserIds = async (
  userIds: string[],
): Promise<Map<string, PushTokenRecord>> => {
  const out = new Map<string, PushTokenRecord>();
  if (userIds.length === 0) return out;
  const CHUNK = 30;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTION).doc(id));
    const docs = await db.getAll(...refs);
    docs.forEach((doc) => {
      if (doc.exists) {
        out.set(doc.id, toRecord(doc.id, doc.data() ?? {}));
      }
    });
  }
  const missing = userIds.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(LEGACY_COLLECTION).doc(id));
    const docs = await db.getAll(...refs);
    const found = docs.filter((doc) => doc.exists);
    await Promise.all(
      found.map(async (doc) => {
        const record = await migrateLegacy(doc.id, doc.data() ?? {});
        out.set(doc.id, record);
      }),
    );
  }
  return out;
};

const registerToken = async (
  userId: string,
  token: string,
): Promise<PushTokenRecord> => {
  const ref = db.collection(COLLECTION).doc(userId);
  const existing = await findByUserId(userId);
  const stored = existing?.tokens ?? [];
  const tokens = stored.filter((value) => value !== token);
  tokens.unshift(token);
  const record: PushTokenRecord = {
    userId,
    tokens: tokens.slice(0, MAX_TOKENS),
    updatedAt: new Date().toISOString(),
  };
  await ref.set(record);
  return record;
};

const unregisterToken = async (
  userId: string,
  token: string,
): Promise<{removed: boolean}> => {
  const existing = await findByUserId(userId);
  if (!existing) return {removed: false};
  const stored = existing.tokens ?? [];
  const tokens = stored.filter((value) => value !== token);
  if (tokens.length === stored.length) {
    return {removed: false};
  }
  await db.collection(COLLECTION).doc(userId).set({
    userId,
    tokens,
    updatedAt: new Date().toISOString(),
  });
  return {removed: true};
};

const removeTokens = async (
  userId: string,
  tokens: string[],
): Promise<void> => {
  if (tokens.length === 0) return;
  const existing = await findByUserId(userId);
  if (!existing) return;
  const dead = new Set(tokens);
  await db.collection(COLLECTION).doc(userId).set({
    userId,
    tokens: (existing.tokens ?? []).filter((value) => !dead.has(value)),
    updatedAt: new Date().toISOString(),
  });
};

export {
  PushTokenRecord,
  findByUserId,
  findByUserIds,
  registerToken,
  unregisterToken,
  removeTokens,
  MAX_TOKENS,
};
