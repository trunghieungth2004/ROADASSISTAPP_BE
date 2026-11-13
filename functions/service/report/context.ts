import * as dispatchRepository from "../../repository/dispatchRepository";
import type {ReportRecord} from "../../repository/reportRepository";
import {timelineFor, type TicketTimelineEntry} from "../ticket/timeline";

type AdminReportTicket = {
  id: string;
  ticketType: string;
  status: string;
  symptom: string | null;
  description: string | null;
  waitingFee: number | null;
  finalAmount: number | null;
  paymentStatus: string | null;
  createdAt: string | null;
  statusHistory: TicketTimelineEntry[];
};

const ticketContext = (
  ticket: dispatchRepository.DispatchTicket | null,
): AdminReportTicket | null => {
  if (!ticket) return null;
  return {
    id: ticket.id,
    ticketType: String(ticket.ticketType ?? ""),
    status: String(ticket.status ?? ""),
    symptom: typeof ticket.symptom === "string" ? ticket.symptom : null,
    description: typeof ticket.description === "string" ?
      ticket.description :
      null,
    waitingFee: typeof ticket.waiting?.fee === "number" ?
      ticket.waiting.fee :
      typeof ticket.waitingFee === "number" ? ticket.waitingFee : null,
    finalAmount: typeof ticket.finalAmount === "number" ?
      ticket.finalAmount :
      null,
    paymentStatus: typeof ticket.paymentStatus === "string" ?
      ticket.paymentStatus :
      null,
    createdAt: typeof ticket.createdAt === "string" ? ticket.createdAt : null,
    statusHistory: timelineFor(ticket),
  };
};

const attachReportContext = async (
  rows: ReportRecord[],
): Promise<Array<ReportRecord & {ticket: AdminReportTicket | null}>> => {
  const ids = rows
    .map((row) => row.ticketId)
    .filter((id): id is string => typeof id === "string" && id !== "");
  if (ids.length === 0) {
    return rows.map((row) => ({...row, ticket: null}));
  }
  const tickets = await dispatchRepository.findByIds(ids);
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return rows.map((row) => ({
    ...row,
    ticket: row.ticketId === null ?
      null :
      ticketContext(byId.get(row.ticketId) ?? null),
  }));
};

export {attachReportContext, AdminReportTicket};
