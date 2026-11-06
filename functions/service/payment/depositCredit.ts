type DepositTicket = {
  depositAmount?: number | null;
  depositStatus?: string | null;
};

const depositCreditFor = (ticket: DepositTicket): number => {
  const amount = typeof ticket.depositAmount === "number" ?
    ticket.depositAmount :
    0;
  const status = typeof ticket.depositStatus === "string" ?
    ticket.depositStatus :
    "";
  if (amount <= 0) return 0;
  if (status !== "COLLECTED" && status !== "CONFIRMED" &&
    status !== "APPLIED") {
    return 0;
  }
  return amount;
};

export {depositCreditFor};
