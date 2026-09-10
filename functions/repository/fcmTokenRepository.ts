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
  const existing = await findByUserId(userId);
  const tokens = [...((existing?.tokens as string[]) ?? [])];
  const at = tokens.indexOf(token);
  if (at !== -1) tokens.splice(at, 1);
  tokens.unshift(token);
  const record = {
    userId,
    tokens: tokens.slice(0, MAX_TOKENS),
    updatedAt: new Date().toISOString(),
  };
  await db.collection("fcm_tokens").doc(userId).set(record);
  return record;
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

export {findByUserId, registerToken, unregisterToken, removeTokens,
  MAX_TOKENS};
