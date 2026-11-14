import type {DispatchTicket} from "../../../repository/dispatchRepository";

type MobileQuoteStatus =
  | "SENT"
  | "DECLINED"
  | "EXPIRED"
  | "APPROVED"
  | "REPLACED";

type MobileQuoteEntry = {
  status: MobileQuoteStatus;
  by: string;
  at?: string;
  reason?: string | null;
  amount?: number;
  items?: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }>;
  version?: number;
};

const appendMobileQuoteHistory = (
  ticket: DispatchTicket,
  entry: MobileQuoteEntry,
): NonNullable<DispatchTicket["quoteHistory"]> => {
  const history = Array.isArray(ticket.quoteHistory) ?
    [...ticket.quoteHistory] :
    [];
  const amount = entry.amount ??
    (typeof ticket.finalAmount === "number" ? ticket.finalAmount : null);
  if (amount === null) return history;
  const items = entry.items ??
    (Array.isArray(ticket.invoiceItems) ? ticket.invoiceItems : []);
  const version = entry.version ??
    (typeof ticket.quoteVersion === "number" ? ticket.quoteVersion : 0);
  history.push({
    version,
    amount,
    items,
    at: entry.at ?? new Date().toISOString(),
    by: entry.by,
    status: entry.status,
    ...(entry.reason !== undefined && entry.reason !== null ?
      {reason: entry.reason} :
      {}),
  });
  return history;
};

export {appendMobileQuoteHistory};
export type {MobileQuoteStatus};
