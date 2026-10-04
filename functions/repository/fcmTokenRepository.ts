import {db} from "../config/firebase";

interface TokenRecord {
  userId: string;
  tokens: string[];
  updatedAt: string;
  [key: string]: unknown;
}

const MAX_TOKENS = 5;

const findByUserId = async (userId: string): Promise<TokenRecord | null> => {
  const doc = await db.collection("fcm_tokens").doc(userId).get();
  if (!doc.exists) return null;
  return {userId: doc.id, ...doc.data()} as TokenRecord;
};

const registerToken = async (
  userId: string,
  token: string,
): Promise<TokenRecord> => {
  const ref = db.collection("fcm_tokens").doc(userId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ?
      ((snap.data() as Partial<TokenRecord>).tokens ?? []) :
      [];
    const tokens = [...stored];
    const at = tokens.indexOf(token);
    if (at !== -1) tokens.splice(at, 1);
    tokens.unshift(token);
    const record: TokenRecord = {
      userId,
      tokens: tokens.slice(0, MAX_TOKENS),
      updatedAt: new Date().toISOString(),
    };
    tx.set(ref, record);
    return record;
  });
};

const unregisterToken = async (
  userId: string,
  token: string,
): Promise<{removed: boolean}> => {
  const existing = await findByUserId(userId);
  if (!existing) return {removed: false};
  const tokens = ((existing.tokens as string[]) ?? []).filter(
    (t) => t !== token,
  );
  if (tokens.length === ((existing.tokens as string[]) ?? []).length) {
    return {removed: false};
  }
  await db
    .collection("fcm_tokens")
    .doc(userId)
    .set({
      userId,
      tokens,
      updatedAt: new Date().toISOString(),
    });
  return {removed: true};
};

const findByUserIds = async (
  userIds: string[],
): Promise<Map<string, TokenRecord>> => {
  const out = new Map<string, TokenRecord>();
  if (userIds.length === 0) return out;
  const IN_CHUNK_SIZE = 30;
  for (let i = 0; i < userIds.length; i += IN_CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + IN_CHUNK_SIZE);
    const refs = chunk.map((id) => db.collection("fcm_tokens").doc(id));
    const docs = await db.getAll(...refs);
    docs.forEach((doc) => {
      if (doc.exists) {
        out.set(doc.id, {userId: doc.id, ...doc.data()} as TokenRecord);
      }
    });
  }
  return out;
};

const removeTokens = async (
  userId: string,
  tokens: string[],
): Promise<void> => {
  if (tokens.length === 0) return;
  const existing = await findByUserId(userId);
  if (!existing) return;
  const dead = new Set(tokens);
  const kept = ((existing.tokens as string[]) ?? []).filter(
    (t) => !dead.has(t),
  );
  await db
    .collection("fcm_tokens")
    .doc(userId)
    .set({
      userId,
      tokens: kept,
      updatedAt: new Date().toISOString(),
    });
};

export {findByUserId, findByUserIds, registerToken, unregisterToken,
  removeTokens, MAX_TOKENS};
