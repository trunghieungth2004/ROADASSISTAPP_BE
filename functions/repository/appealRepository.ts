import {db} from "../config/firebase";
import {APPEAL_COLLECTION, APPEAL_STATUS} from "../constants/appeals";

interface Appeal {
  id: string;
  subjectKind: string;
  subjectId: string;
  ticketId: string | null;
  filedBy: string;
  reason: string;
  note: string | null;
  photoUrls: string[];
  snapshot: Record<string, unknown>;
  status: string;
  resolution: string | null;
  decisionNote: string | null;
  adjustedAmount: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  [key: string]: unknown;
}

const toAppeal = (id: string, data: Record<string, unknown>): Appeal => ({
  id,
  ...data,
  subjectKind: String(data.subjectKind ?? ""),
  subjectId: String(data.subjectId ?? ""),
  ticketId: typeof data.ticketId === "string" ? data.ticketId : null,
  filedBy: String(data.filedBy ?? ""),
  reason: String(data.reason ?? ""),
  note: typeof data.note === "string" ? data.note : null,
  photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls as string[] : [],
  snapshot: typeof data.snapshot === "object" && data.snapshot !== null ?
    data.snapshot as Record<string, unknown> :
    {},
  status: typeof data.status === "string" ? data.status : APPEAL_STATUS.OPEN,
  resolution: typeof data.resolution === "string" ? data.resolution : null,
  decisionNote: typeof data.decisionNote === "string" ?
    data.decisionNote :
    null,
  adjustedAmount: typeof data.adjustedAmount === "number" ?
    data.adjustedAmount :
    null,
  decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : null,
  decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : null,
  createdAt: String(data.createdAt ?? ""),
});

const create = async (data: {
  subjectKind: string;
  subjectId: string;
  ticketId?: string | null;
  filedBy: string;
  reason: string;
  note?: string | null;
  photoUrls?: string[];
  snapshot: Record<string, unknown>;
}): Promise<Appeal> => {
  const ref = db.collection(APPEAL_COLLECTION).doc();
  const now = new Date().toISOString();
  const doc = {
    id: ref.id,
    subjectKind: data.subjectKind,
    subjectId: data.subjectId,
    ticketId: data.ticketId ?? null,
    filedBy: data.filedBy,
    reason: data.reason,
    note: data.note ?? null,
    photoUrls: data.photoUrls ?? [],
    snapshot: data.snapshot,
    status: APPEAL_STATUS.OPEN,
    resolution: null,
    decisionNote: null,
    adjustedAmount: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
  };
  await ref.set(doc);
  return toAppeal(ref.id, doc);
};

const findById = async (id: string): Promise<Appeal | null> => {
  const doc = await db.collection(APPEAL_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return toAppeal(doc.id, doc.data() ?? {});
};

const findOpen = async (
  subjectKind: string,
  subjectId: string,
  filedBy: string,
): Promise<Appeal | null> => {
  const snap = await db
    .collection(APPEAL_COLLECTION)
    .where("subjectKind", "==", subjectKind)
    .where("subjectId", "==", subjectId)
    .where("filedBy", "==", filedBy)
    .where("status", "==", APPEAL_STATUS.OPEN)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return toAppeal(doc.id, doc.data() ?? {});
};

const countBySubject = async (
  subjectKind: string,
  subjectId: string,
  filedBy: string,
): Promise<number> => {
  const snap = await db
    .collection(APPEAL_COLLECTION)
    .where("subjectKind", "==", subjectKind)
    .where("subjectId", "==", subjectId)
    .where("filedBy", "==", filedBy)
    .get();
  return snap.size;
};

const findBySubjectIds = async (
  subjectKind: string,
  subjectIds: string[],
  filedBy: string,
): Promise<Appeal[]> => {
  const unique = [...new Set(subjectIds.filter((id) => id !== ""))];
  const rows: Appeal[] = [];
  for (const subjectId of unique) {
    const snap = await db
      .collection(APPEAL_COLLECTION)
      .where("subjectKind", "==", subjectKind)
      .where("subjectId", "==", subjectId)
      .where("filedBy", "==", filedBy)
      .get();
    snap.forEach((doc) => rows.push(toAppeal(doc.id, doc.data() ?? {})));
  }
  return rows;
};

const findAll = async (limit = 1000): Promise<Appeal[]> => {
  const snap = await db.collection(APPEAL_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const rows: Appeal[] = [];
  snap.forEach((doc) => rows.push(toAppeal(doc.id, doc.data() ?? {})));
  return rows;
};

const list = async (options: {
  subjectKind?: string;
  status?: string;
}): Promise<Appeal[]> => {
  let query = db.collection(APPEAL_COLLECTION)
    .orderBy("createdAt", "desc") as FirebaseFirestore.Query;
  if (options.status !== undefined && options.status !== "") {
    query = query.where("status", "==", options.status);
  }
  if (options.subjectKind !== undefined && options.subjectKind !== "") {
    query = query.where("subjectKind", "==", options.subjectKind);
  }
  const snap = await query.limit(100).get();
  const rows: Appeal[] = [];
  snap.forEach((doc) => rows.push(toAppeal(doc.id, doc.data() ?? {})));
  return rows;
};

const decide = async (
  id: string,
  data: {
    status: string;
    resolution: string;
    decisionNote: string;
    adjustedAmount?: number | null;
    decidedBy: string;
  },
): Promise<Appeal | null> => {
  await db.collection(APPEAL_COLLECTION).doc(id).update({
    status: data.status,
    resolution: data.resolution,
    decisionNote: data.decisionNote,
    ...(typeof data.adjustedAmount === "number" ?
      {adjustedAmount: data.adjustedAmount} :
      {}),
    decidedBy: data.decidedBy,
    decidedAt: new Date().toISOString(),
  });
  return findById(id);
};

export {
  Appeal,
  create,
  findById,
  findOpen,
  countBySubject,
  findBySubjectIds,
  findAll,
  list,
  decide,
};
