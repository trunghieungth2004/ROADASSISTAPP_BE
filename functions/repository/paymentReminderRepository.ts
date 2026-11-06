import {db} from "../config/firebase";
import type {DispatchTicket} from "./dispatchRepository";

const findDue = async (
  cutoffIso: string,
  limit = 200,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("paymentDueAt", "<=", cutoffIso)
    .limit(limit)
    .get();
  const results: DispatchTicket[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as DispatchTicket),
  );
  return results;
};

export {findDue};
