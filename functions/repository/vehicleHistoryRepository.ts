import {db} from "../config/firebase";
import type {DispatchTicket} from "./dispatchRepository";

const findByVehicleId = async (
  vehicleId: string,
  limit = 100,
): Promise<DispatchTicket[]> => {
  const snap = await db
    .collection("dispatch_tickets")
    .where("vehicleId", "==", vehicleId)
    .limit(limit)
    .get();
  const rows: DispatchTicket[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as DispatchTicket));
  rows.sort((a, b) =>
    String(a.createdAt ?? "") < String(b.createdAt ?? "") ? 1 : -1);
  return rows;
};

export {findByVehicleId};
