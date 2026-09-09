import {db} from "../config/firebase";

interface RoleRecord {
  id: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

const findAll = async (): Promise<RoleRecord[]> => {
  const snapshot = await db.collection("roles").get();
  const results: RoleRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as RoleRecord),
  );
  return results;
};

const findById = async (roleId: string): Promise<RoleRecord | null> => {
  const doc = await db.collection("roles").doc(roleId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as RoleRecord;
};

export {findAll, findById};
