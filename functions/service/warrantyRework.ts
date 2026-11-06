type WarrantyTicket = {
  warrantyOfTicketId?: unknown;
  warrantyClaimId?: unknown;
};

const nonEmpty = (value: unknown): boolean =>
  typeof value === "string" && value !== "";

export const isWarrantyRework = (ticket: WarrantyTicket): boolean =>
  nonEmpty(ticket.warrantyOfTicketId) ||
  nonEmpty(ticket.warrantyClaimId);
