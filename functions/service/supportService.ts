import * as supportRepository from "../repository/supportRepository";
import * as userRepository from "../repository/userRepository";
import {
  SUPPORT_ANSWER_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_STATUS,
} from "../constants/support";
import {ROLE_ADMIN} from "../constants/roles";
import {ForbiddenError, NotFoundError, ValidationError} from "../utils/errors";
import {deliverAdminPush} from "./push/admin";
import * as auditService from "./auditService";

const createTicket = async (input: {
  userId: string;
  category: string;
  message: string;
  ticketId?: string;
}): Promise<Record<string, unknown>> => {
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new ValidationError("Unknown support category");
  }
  const message = input.message.trim();
  if (message.length < SUPPORT_MESSAGE_MIN ||
    message.length > SUPPORT_MESSAGE_MAX) {
    throw new ValidationError("Describe the issue in 10-1000 characters");
  }
  const ticket = await supportRepository.create({
    userId: input.userId,
    category: input.category,
    message,
    ticketId: input.ticketId ?? null,
  });
  await deliverAdminPush({
    event: "SUPPORT_MESSAGE",
    title: "New support message",
    body: `${input.category}: ${message.slice(0, 120)}`,
    refId: String(ticket.id ?? ""),
    route: "/admin?section=support",
  }).catch(() => undefined);
  return ticket;
};

const myTickets = async (input: {
  userId: string;
}): Promise<Record<string, unknown>> => {
  const rows = await supportRepository.findByUser(input.userId);
  return {tickets: rows};
};

const adminList = async (input: {
  userId: string;
  status?: string;
}): Promise<Record<string, unknown>> => {
  const caller = await userRepository.findById(input.userId);
  if (!caller || caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin only");
  }
  const status = input.status ?? SUPPORT_STATUS.OPEN;
  const rows = await supportRepository.findByStatus(status);
  return {tickets: rows};
};

const respond = async (input: {
  userId: string;
  supportId: string;
  answer: string;
  close?: boolean;
}): Promise<Record<string, unknown>> => {
  const caller = await userRepository.findById(input.userId);
  if (!caller || caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin only");
  }
  const ticket = await supportRepository.findById(input.supportId);
  if (!ticket) throw new NotFoundError("Support ticket not found");
  const answer = input.answer.trim();
  if (answer === "" || answer.length > SUPPORT_ANSWER_MAX) {
    throw new ValidationError("Answer is invalid");
  }
  const status = input.close === true ?
    SUPPORT_STATUS.CLOSED :
    SUPPORT_STATUS.ANSWERED;
  await supportRepository.update(ticket.id, {
    answer,
    answeredAt: new Date().toISOString(),
    answeredBy: input.userId,
    status,
  });
  await auditService.record({
    adminUid: input.userId,
    action: input.close === true ? "SUPPORT_CLOSED" : "SUPPORT_REPLIED",
    category: "CONTENT",
    targetType: "SUPPORT",
    targetId: ticket.id,
    targetLabel: String(ticket.category ?? ticket.id ?? ""),
    before: {status: ticket.status},
    after: {status},
    note: answer,
    meta: {requesterUid: ticket.userId ?? null},
  });
  return {...ticket, answer, status};
};

export {createTicket, myTickets, adminList, respond};
