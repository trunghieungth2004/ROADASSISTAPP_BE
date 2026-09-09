import {db} from "../config/firebase";

interface Diagnostic {
  id: string;
  userId: string;
  category: string;
  imagePath: string;
  [key: string]: unknown;
}

const create = async (data: {
  userId: string;
  category: string;
  imagePath: string;
}): Promise<Diagnostic> => {
  const ref = db.collection("diagnostics").doc();
  const doc = {
    id: ref.id,
    ...data,
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<Diagnostic | null> => {
  const doc = await db.collection("diagnostics").doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Diagnostic;
};

export {create, findById};
