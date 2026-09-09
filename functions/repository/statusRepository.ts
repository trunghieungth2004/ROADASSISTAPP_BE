import {db} from "../config/firebase";

interface StatusRecord {
  id: string;
  domain?: string;
  code?: string;
  name?: string;
  description?: string;
  order?: number;
  [key: string]: unknown;
}

const findAll = async (): Promise<StatusRecord[]> => {
  const snapshot = await db.collection("statuses").get();
  const results: StatusRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as StatusRecord),
  );
  return results;
};

export {findAll};
