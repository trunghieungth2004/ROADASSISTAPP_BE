import * as paymentRepository from "../../../repository/paymentRepository";
import * as paymentService from "../../paymentService";
import type {DispatchTicket} from "../../../repository/dispatchRepository";
import * as platformConfigService from "../../platformConfigService";

const ensureTowCashCharge = async (
  ticket: DispatchTicket,
  ticketId: string,
): Promise<void> => {
  try {
    const config = await platformConfigService.getConfig()
      .catch(() => null);
    if (config?.features?.towCashAtDelivery === false) return;
    const payments = await paymentRepository.findByTicketId(ticketId);
    if (Array.isArray(payments) && payments.length === 0) {
      await paymentService.createPaymentForTicket({
        userId: ticket.userId,
        ticketId,
        method: "CASH",
      });
    }
  } catch {
    void 0;
  }
};

export {ensureTowCashCharge};
