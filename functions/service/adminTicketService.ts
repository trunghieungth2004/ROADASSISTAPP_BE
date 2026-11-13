import * as dispatchRepository from "../repository/dispatchRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {ROLE_ADMIN} from "../constants/roles";
import {ForbiddenError, NotFoundError} from "../utils/errors";

const listTickets = async (input: {
  adminUid: string;
  status?: string;
  limit?: number;
}) => {
  const caller = await userRepository.findById(input.adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
  const rows = await dispatchRepository.findAll(
    typeof input.limit === "number" ?
      Math.min(Math.max(input.limit, 1), 500) :
      200,
  );
  const filtered = typeof input.status === "string" && input.status !== "" ?
    rows.filter((ticket) => ticket.status === input.status) :
    rows;
  const riderIds = [...new Set(filtered.map((ticket) => ticket.userId))];
  const providerIds = [...new Set(filtered.flatMap((ticket) =>
    [ticket.assignedShopId, ticket.providerId, ticket.destinationShopId]
      .filter((id): id is string => typeof id === "string" && id !== "")))];
  const [users, providers] = await Promise.all([
    userRepository.findByIds(riderIds),
    providerRepository.findByIds(providerIds),
  ]);
  return filtered.map((ticket) => {
    const rider = users.get(ticket.userId);
    const providerId = [ticket.assignedShopId, ticket.providerId,
      ticket.destinationShopId]
      .find((id): id is string => typeof id === "string" && id !== "");
    const provider = providerId === undefined ?
      undefined :
      providers.get(providerId);
    const towFare = ticket.towFare && typeof ticket.towFare === "object" ?
      ticket.towFare as Record<string, unknown> :
      null;
    const amount = typeof ticket.finalAmount === "number" ?
      ticket.finalAmount :
      typeof ticket.shopQuotedAmount === "number" ?
        ticket.shopQuotedAmount :
        typeof towFare?.final === "number" ?
          towFare.final :
          typeof towFare?.estimate === "number" ? towFare.estimate : null;
    return {
      id: ticket.id,
      ticketType: String(ticket.ticketType ?? ""),
      status: String(ticket.status ?? ""),
      riderId: ticket.userId,
      riderName: typeof rider?.displayName === "string" &&
        rider.displayName !== "" ?
        rider.displayName :
        typeof rider?.email === "string" ? rider.email : null,
      riderEmail: typeof rider?.email === "string" ? rider.email : null,
      providerId: providerId ?? null,
      providerName: provider?.name ?? null,
      providerKind: provider?.kind ?? null,
      paymentStatus: typeof ticket.paymentStatus === "string" ?
        ticket.paymentStatus :
        null,
      amount,
      createdAt: typeof ticket.createdAt === "string" ?
        ticket.createdAt :
        null,
      statusHistory: Array.isArray(ticket.statusHistory) ?
        ticket.statusHistory :
        [],
      description: typeof ticket.description === "string" ?
        ticket.description :
        null,
      symptom: typeof ticket.symptom === "string" ? ticket.symptom : null,
    };
  });
};

export {listTickets};
