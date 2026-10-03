import {db} from "../config/firebase";

interface ProviderReport {
  id: string;
  providerId: string;
  providerKind: string;
  targetUid: string | null;
  reportedBy: string;
  ticketId: string | null;
  reason: string;
  note: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  [key: string]: unknown;
}

const COLLECTION = "provider_reports";

const create = async (data: {
  providerId: string;
  providerKind: string;
  targetUid: string | null;
  reportedBy: string;
  ticketId?: string | null;
  reason: string;
  note?: string | null;
}): Promise<ProviderReport> => {
  const ref = db.collection(COLLECTION).doc();
  const doc = {
    id: ref.id,
    providerId: data.providerId,
    providerKind: data.providerKind,
    targetUid: data.targetUid,
    reportedBy: data.reportedBy,
    ticketId: data.ticketId ?? null,
    reason: data.reason,
    note: data.note ?? null,
    status: "OPEN",
    resolution: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
  };
  await ref.set(doc);
  return doc;
};

const findOpenByReporter = async (
  providerId: string,
  reportedBy: string,
): Promise<ProviderReport | null> => {
  const snapshot = await db
    .collection(COLLECTION)
    .where("providerId", "==", providerId)
    .where("reportedBy", "==", reportedBy)
    .where("status", "==", "OPEN")
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return {id: doc.id, ...doc.data()} as ProviderReport;
};

const listOpen = async (): Promise<ProviderReport[]> => {
  const snapshot = await db
    .collection(COLLECTION)
    .where("status", "==", "OPEN")
    .orderBy("createdAt", "asc")
    .get();
  const results: ProviderReport[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as ProviderReport),
  );
  return results;
};

const countOpenForProvider = async (providerId: string): Promise<number> => {
  const agg = await db
    .collection(COLLECTION)
    .where("providerId", "==", providerId)
    .where("status", "==", "OPEN")
    .count()
    .get();
  return agg.data().count;
};

const findById = async (reportId: string): Promise<ProviderReport | null> => {
  const doc = await db.collection(COLLECTION).doc(reportId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as ProviderReport;
};

const decide = async (
  reportId: string,
  patch: {
    status: string;
    resolution: string | null;
    decidedBy: string;
  },
): Promise<boolean> => {
  let decided = false;
  await db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTION).doc(reportId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    if (data.status !== "OPEN") return;
    tx.update(ref, {
      status: patch.status,
      resolution: patch.resolution,
      decidedBy: patch.decidedBy,
      decidedAt: new Date().toISOString(),
    });
    decided = true;
  });
  return decided;
};

export {
  ProviderReport,
  create,
  findOpenByReporter,
  listOpen,
  countOpenForProvider,
  findById,
  decide,
};
