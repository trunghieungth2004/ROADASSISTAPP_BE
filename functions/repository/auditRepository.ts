import {db} from "../config/firebase";

const AUDIT_COLLECTION = "admin_audit";

interface AuditRow {
  id: string;
  adminUid: string;
  action: string;
  targetType: string;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  [key: string]: unknown;
}

const create = async (data: {
  adminUid: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> => {
  const ref = db.collection(AUDIT_COLLECTION).doc();
  const row: AuditRow = {
    id: ref.id,
    adminUid: data.adminUid,
    action: data.action,
    targetType: data.targetType,
    targetId: data.targetId ?? null,
    meta: data.meta ?? null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(row);
};

const findAll = async (limit = 100): Promise<AuditRow[]> => {
  const snap = await db
    .collection(AUDIT_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const rows: AuditRow[] = [];
  snap.forEach((doc) => rows.push({id: doc.id, ...doc.data()} as AuditRow));
  return rows;
};

export {AuditRow, create, findAll};
