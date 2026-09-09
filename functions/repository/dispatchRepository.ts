import {db} from "../config/firebase";

interface DispatchTicket {
  id: string;
  userId: string;
  ticketType: string;
  status: string;
  lat: number;
  lng: number;
  diagnosticId?: string | null;
  [key: string]: unknown;
}

const create = async (data: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
}): Promise<DispatchTicket> => {
  const ref = db.collection("dispatch_tickets").doc();
  const doc = {
    id: ref.id,
    userId: data.userId,
    ticketType: data.ticketType,
    lat: data.lat,
    lng: data.lng,
    diagnosticId: data.diagnosticId ?? null,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<DispatchTicket | null> => {
  const doc = await db.collection("dispatch_tickets").doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as DispatchTicket;
};

const updateStatus = async (id: string, status: string): Promise<void> => {
  await db.collection("dispatch_tickets").doc(id).update({status});
};

export {create, findById, updateStatus};
