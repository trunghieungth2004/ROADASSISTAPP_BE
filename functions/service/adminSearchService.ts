import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {ROLE_ADMIN} from "../constants/roles";
import {ForbiddenError, NotFoundError} from "../utils/errors";

const search = async (input: {adminUid: string; query: string}) => {
  const caller = await userRepository.findById(input.adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
  const q = input.query.trim().toLowerCase();
  if (q === "") {
    return {users: [], providers: [], tickets: [], payments: []};
  }
  const [users, providers, tickets, payments] = await Promise.all([
    userRepository.findAll(),
    providerRepository.findAll(),
    dispatchRepository.findAll(500),
    paymentRepository.findAll(500),
  ]);
  const text = (value: unknown): string =>
    typeof value === "string" ? value.toLowerCase() : "";
  return {
    users: users.filter((user) =>
      text(user.id).includes(q) ||
      text(user.email).includes(q) ||
      text(user.displayName).includes(q) ||
      text(user.phone).includes(q)).slice(0, 8).map((user) => ({
      id: user.id,
      name: typeof user.displayName === "string" ? user.displayName : null,
      email: typeof user.email === "string" ? user.email : null,
      phone: typeof user.phone === "string" ? user.phone : null,
      role: typeof user.role === "string" ? user.role : null,
      status: typeof user.status === "string" ? user.status : null,
    })),
    providers: providers.filter((provider) =>
      text(provider.id).includes(q) ||
      text(provider.name).includes(q) ||
      text(provider.plate).includes(q)).slice(0, 8).map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      status: provider.status,
      plate: typeof provider.plate === "string" ? provider.plate : null,
    })),
    tickets: tickets.filter((ticket) =>
      text(ticket.id).includes(q) ||
      text(ticket.userId).includes(q) ||
      text(ticket.assignedShopId).includes(q)).slice(0, 8).map((ticket) => ({
      id: ticket.id,
      ticketType: String(ticket.ticketType ?? ""),
      status: String(ticket.status ?? ""),
      riderId: ticket.userId,
      createdAt: typeof ticket.createdAt === "string" ? ticket.createdAt : null,
    })),
    payments: payments.filter((payment) =>
      text(payment.id).includes(q) ||
      text(payment.ticketId).includes(q) ||
      text(payment.riderUid).includes(q) ||
      text(payment.payeeId).includes(q)).slice(0, 8).map((payment) => ({
      id: payment.id,
      ticketId: payment.ticketId,
      amount: payment.amount,
      method: payment.method,
      status: payment.status,
      createdAt: payment.createdAt,
    })),
  };
};

export {search};
