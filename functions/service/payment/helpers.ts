import * as providerRepository from "../../repository/providerRepository";
import {
  PAYMENT_QR_PREFIX,
  PAYMENT_QR_TICKET_LENGTH,
} from "../../constants/payments";
import {ValidationError} from "../../utils/errors";

type PayeeTicket = {
  assignedShopId?: string | null;
  destinationShopId?: string | null;
  providerId?: string | null;
  assignedUid?: string | null;
};

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const resolvePayeeId = async (ticket: PayeeTicket): Promise<string> => {
  const shopIds = [
    ticket.assignedShopId,
    ticket.providerId,
    ticket.destinationShopId,
  ].filter(nonEmpty);
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && nonEmpty(shop.operatorUid)) {
      return shop.operatorUid;
    }
  }
  if (nonEmpty(ticket.assignedUid)) return ticket.assignedUid;
  throw new ValidationError("Ticket has no payee yet");
};

const generateQrRef = (ticketId: string): string => {
  const ticketPart = ticketId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, PAYMENT_QR_TICKET_LENGTH)
    .toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  return `${PAYMENT_QR_PREFIX}${ticketPart}${stamp}`;
};

export {resolvePayeeId, generateQrRef};
