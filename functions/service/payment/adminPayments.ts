import * as dispatchRepository from "../../repository/dispatchRepository";
import * as paymentRepository from "../../repository/paymentRepository";
import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import {
  PAYMENT_LIST_LIMIT,
  PAYMENT_LIST_MAX,
} from "../../constants/payments";
import {ROLE_ADMIN} from "../../constants/roles";
import {ForbiddenError, NotFoundError} from "../../utils/errors";

const listPayments = async ({
  adminUid,
  status,
  limit,
}: {
  adminUid: string;
  status?: string;
  limit?: number;
}): Promise<Array<paymentRepository.Payment & {
  riderName: string | null;
  riderEmail: string | null;
  payeeName: string | null;
  payeeKind: string | null;
  ticketType: string | null;
  ticketStatus: string | null;
}>> => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYMENT_LIST_MAX) :
    PAYMENT_LIST_LIMIT;
  const rows = typeof status === "string" && status !== "" ?
    await paymentRepository.findByStatus(status, capped) :
    await paymentRepository.findAll(capped);
  const riderIds = [...new Set(rows.map((row) => row.riderUid))];
  const payeeIds = [...new Set(rows.map((row) => row.payeeId))];
  const ticketIds = [...new Set(rows.map((row) => row.ticketId))];
  const [users, providers, tickets] = await Promise.all([
    userRepository.findByIds(riderIds),
    providerRepository.findByIds(payeeIds),
    dispatchRepository.findByIds(ticketIds),
  ]);
  const ticketMap = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return rows.map((row) => {
    const rider = users.get(row.riderUid);
    const provider = providers.get(row.payeeId);
    const payeeUser = users.get(row.payeeId);
    const ticket = ticketMap.get(row.ticketId);
    return {
      ...row,
      riderName: typeof rider?.displayName === "string" &&
        rider.displayName !== "" ?
        rider.displayName :
        typeof rider?.email === "string" ? rider.email : null,
      riderEmail: typeof rider?.email === "string" ? rider.email : null,
      payeeName: provider?.name ??
        (typeof payeeUser?.displayName === "string" ?
          payeeUser.displayName :
          null),
      payeeKind: provider?.kind ?? null,
      ticketType: typeof ticket?.ticketType === "string" ?
        ticket.ticketType :
        null,
      ticketStatus: typeof ticket?.status === "string" ?
        ticket.status :
        null,
    };
  });
};

export {listPayments};
