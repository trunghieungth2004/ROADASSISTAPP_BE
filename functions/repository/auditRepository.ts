import {db} from "../config/firebase";

const AUDIT_COLLECTION = "admin_audit";

interface AuditRow {
  id: string;
  adminUid: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  category: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  requestId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  [key: string]: unknown;
}

const create = async (data: {
  adminUid: string;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  category?: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  requestId?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> => {
  const ref = db.collection(AUDIT_COLLECTION).doc();
  const row: AuditRow = {
    id: ref.id,
    adminUid: data.adminUid,
    actorName: data.actorName ?? null,
    actorEmail: data.actorEmail ?? null,
    action: data.action,
    category: data.category ?? "SYSTEM",
    targetType: data.targetType,
    targetId: data.targetId ?? null,
    targetLabel: data.targetLabel ?? null,
    before: data.before ?? null,
    after: data.after ?? null,
    note: data.note ?? null,
    requestId: data.requestId ?? null,
    meta: data.meta ?? null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(row);
};

const findAll = async ({
  limit = 100,
  before,
  from,
  to,
}: {
  limit?: number;
  before?: string;
  from?: string;
  to?: string;
} = {}): Promise<AuditRow[]> => {
  let query = db.collection(AUDIT_COLLECTION)
    .orderBy("createdAt", "desc");
  if (from !== undefined && from !== "") {
    query = query.where("createdAt", ">=", from);
  }
  if (to !== undefined && to !== "") {
    query = query.where("createdAt", "<=", to);
  }
  if (before !== undefined && before !== "") {
    query = query.startAfter(before);
  }
  const snap = await query.limit(limit).get();
  const rows: AuditRow[] = [];
  snap.forEach((doc) => rows.push({id: doc.id, ...doc.data()} as AuditRow));
  return rows;
};

export {AuditRow, create, findAll};
