import {db} from "../config/firebase";
import {
  LEGACY_PROVIDER_REPORT_COLLECTION,
  REPORT_COLLECTION,
  REPORT_STATUS,
} from "../constants/behaviorReports";

interface ReportRecord {
  id: string;
  targetKind: string;
  targetId: string;
  targetUid: string | null;
  reportedBy: string;
  ticketId: string | null;
  reason: string;
  note: string | null;
  photoUrls: string[];
  status: string;
  action: string;
  actionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  [key: string]: unknown;
}

const toReport = (
  id: string,
  data: Record<string, unknown>,
): ReportRecord => {
  const targetKind = typeof data.targetKind === "string" ?
    data.targetKind :
    "PROVIDER";
  return {
    id,
    ...data,
    targetKind,
    targetId: String(data.targetId ?? data.providerId ?? ""),
    targetUid: typeof data.targetUid === "string" ? data.targetUid : null,
    ticketId: typeof data.ticketId === "string" ? data.ticketId : null,
    note: typeof data.note === "string" ? data.note : null,
    photoUrls: Array.isArray(data.photoUrls) ?
      data.photoUrls as string[] :
      [],
    status: typeof data.status === "string" ?
      data.status :
      REPORT_STATUS.OPEN,
    action: typeof data.action === "string" ? data.action : "NONE",
    actionNote: typeof data.actionNote === "string" ? data.actionNote : null,
    createdAt: String(data.createdAt ?? ""),
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : null,
    decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : null,
  } as ReportRecord;
};

const migrateLegacy = async (
  id: string,
  data: Record<string, unknown>,
): Promise<ReportRecord> => {
  const record = toReport(id, {
    ...data,
    targetKind: "PROVIDER",
    targetId: data.providerId,
    targetUid: data.targetUid,
    photoUrls: [],
    action: "NONE",
  });
  await db.collection(REPORT_COLLECTION).doc(id).set(record);
  await db.collection(LEGACY_PROVIDER_REPORT_COLLECTION).doc(id).delete();
  return record;
};

const findById = async (reportId: string): Promise<ReportRecord | null> => {
  const doc = await db.collection(REPORT_COLLECTION).doc(reportId).get();
  if (doc.exists) return toReport(doc.id, doc.data() ?? {});
  const legacy = await db
    .collection(LEGACY_PROVIDER_REPORT_COLLECTION)
    .doc(reportId)
    .get();
  if (!legacy.exists) return null;
  return migrateLegacy(reportId, legacy.data() ?? {});
};

const legacyRows = async (): Promise<ReportRecord[]> => {
  const snap = await db.collection(LEGACY_PROVIDER_REPORT_COLLECTION).get();
  const rows: ReportRecord[] = [];
  for (const doc of snap.docs) {
    rows.push(await migrateLegacy(doc.id, doc.data()));
  }
  return rows;
};

const list = async (options: {
  targetKind?: string;
  status?: string;
  limit?: number;
}): Promise<ReportRecord[]> => {
  const rows = await legacyRows();
  let query = db.collection(REPORT_COLLECTION).orderBy("createdAt", "desc");
  if (options.status !== undefined && options.status !== "") {
    query = db
      .collection(REPORT_COLLECTION)
      .where("status", "==", options.status)
      .orderBy("createdAt", "desc");
  }
  const snap = await query.limit(options.limit ?? 100).get();
  const out: ReportRecord[] = [...rows];
  snap.forEach((doc) => {
    if (!out.some((row) => row.id === doc.id)) {
      out.push(toReport(doc.id, doc.data() ?? {}));
    }
  });
  return out
    .filter((row) =>
      options.targetKind === undefined ||
      options.targetKind === "" ||
      row.targetKind === options.targetKind)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

const findByReporter = async (reportedBy: string): Promise<ReportRecord[]> => {
  const snap = await db
    .collection(REPORT_COLLECTION)
    .where("reportedBy", "==", reportedBy)
    .get();
  const rows: ReportRecord[] = [];
  snap.forEach((doc) => rows.push(toReport(doc.id, doc.data() ?? {})));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
};

const findOpenDuplicate = async (
  reportedBy: string,
  targetKind: string,
  targetId: string,
  ticketId: string | null,
): Promise<ReportRecord | null> => {
  const rows = await list({status: REPORT_STATUS.OPEN, limit: 200});
  return rows.find((row) =>
    row.reportedBy === reportedBy &&
    row.targetKind === targetKind &&
    row.targetId === targetId &&
    (row.ticketId ?? "") === (ticketId ?? ""),
  ) ?? null;
};

const create = async (data: {
  targetKind: string;
  targetId: string;
  targetUid: string | null;
  reportedBy: string;
  ticketId?: string | null;
  reason: string;
  note?: string | null;
  photoUrls?: string[];
}): Promise<ReportRecord> => {
  const ref = db.collection(REPORT_COLLECTION).doc();
  const record: ReportRecord = {
    id: ref.id,
    targetKind: data.targetKind,
    targetId: data.targetId,
    targetUid: data.targetUid ?? null,
    reportedBy: data.reportedBy,
    ticketId: data.ticketId ?? null,
    reason: data.reason,
    note: data.note ?? null,
    photoUrls: data.photoUrls ?? [],
    status: REPORT_STATUS.OPEN,
    action: "NONE",
    actionNote: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
  };
  await ref.set(record);
  return record;
};

const decide = async (
  reportId: string,
  data: {
    status: string;
    action: string;
    actionNote: string | null;
    decidedBy: string;
  },
): Promise<ReportRecord | null> => {
  await db.collection(REPORT_COLLECTION).doc(reportId).update({
    status: data.status,
    action: data.action,
    actionNote: data.actionNote,
    decidedBy: data.decidedBy,
    decidedAt: new Date().toISOString(),
  });
  return findById(reportId);
};

const countUpheldForTarget = async (
  targetKind: string,
  targetId: string,
  since: string,
): Promise<number> => {
  const snap = await db
    .collection(REPORT_COLLECTION)
    .where("targetKind", "==", targetKind)
    .where("targetId", "==", targetId)
    .where("status", "==", REPORT_STATUS.RESOLVED)
    .get();
  let count = 0;
  snap.forEach((doc) => {
    const data = doc.data();
    if (typeof data.decidedAt === "string" && data.decidedAt >= since) {
      count += 1;
    }
  });
  return count;
};

export {
  ReportRecord,
  findById,
  list,
  findByReporter,
  findOpenDuplicate,
  create,
  decide,
  countUpheldForTarget,
};
