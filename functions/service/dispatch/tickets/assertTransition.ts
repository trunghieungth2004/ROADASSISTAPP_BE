import {TERMINAL_STATUSES} from "../constants";
import {STATUS_DISPATCH} from "../../../constants/status";
import {
  ForbiddenError,
  ValidationError,
} from "../../../utils/errors";

export const assertTransition = ({
  ticket,
  status,
  isRider,
  isOperator,
  isAssignee,
  isAdmin,
}: {
  ticket: {status: string; ticketType: string; shopQuotedAmount?: unknown};
  status: string;
  isRider: boolean;
  isOperator: boolean;
  isAssignee: boolean;
  isAdmin: boolean;
}): void => {
  if (isAdmin) return;
  const from = ticket.status;
  if (TERMINAL_STATUSES.has(from)) {
    throw new ValidationError("Ticket is already closed");
  }
  const shopFlow = isOperator;
  if (status === STATUS_DISPATCH.MATCHED) {
    throw new ValidationError("Use accept to match a ticket");
  }
  if (status === STATUS_DISPATCH.ARRIVED) {
    if (from === STATUS_DISPATCH.MATCHED) {
      if (ticket.ticketType === "TOW" && (isOperator || isAssignee)) return;
      if (ticket.ticketType !== "TOW" && isRider) return;
    }
    throw new ForbiddenError(
      ticket.ticketType === "TOW" ?
        "Only the assigned tower marks arrival" :
        "Only the rider marks arrival",
    );
  }
  if (status === STATUS_DISPATCH.QUOTED ||
    status === STATUS_DISPATCH.ESTIMATED ||
    status === STATUS_DISPATCH.EST_APPROVED ||
    status === STATUS_DISPATCH.FINAL_QUOTED ||
    status === STATUS_DISPATCH.UNFIXABLE ||
    status === STATUS_DISPATCH.RESOLVED_UNFIXABLE) {
    throw new ValidationError("Quotes are sent, not set");
  }
  if (status === STATUS_DISPATCH.IN_SHOP) {
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if ((from === STATUS_DISPATCH.ARRIVED ||
      from === STATUS_DISPATCH.MATCHED ||
      from === STATUS_DISPATCH.QUOTED ||
      from === STATUS_DISPATCH.EST_APPROVED) && shopFlow) return;
    throw new ForbiddenError("Only the helper receives the vehicle");
  }
  if (status === STATUS_DISPATCH.IN_PROGRESS) {
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if (from === STATUS_DISPATCH.QUOTED) {
      throw new ForbiddenError("Quote needs rider approval");
    }
    if (from === STATUS_DISPATCH.FINAL_QUOTED) {
      throw new ForbiddenError("Quote needs rider approval");
    }
    const quoted = typeof ticket.shopQuotedAmount === "number";
    const arrived = from === STATUS_DISPATCH.MATCHED &&
      ticket.ticketType === "WALK_IN" && !quoted;
    if ((from === STATUS_DISPATCH.ARRIVED || arrived) && shopFlow) return;
    throw new ForbiddenError("Only the helper starts work");
  }
  if (status === STATUS_DISPATCH.READY) {
    if (ticket.ticketType === "SOS") {
      if (from === STATUS_DISPATCH.ARRIVED && shopFlow) return;
      throw new ForbiddenError("Only the mobile shop marks the fix complete");
    }
    if (ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if (from === STATUS_DISPATCH.IN_PROGRESS && shopFlow) return;
    throw new ForbiddenError("Only the helper marks work ready");
  }
  if (status === STATUS_DISPATCH.RESOLVED) {
    if (from === STATUS_DISPATCH.ARRIVED &&
      ticket.ticketType === "TOW" &&
      (isOperator || isAssignee)) {
      return;
    }
    if (ticket.ticketType !== "TOW" &&
      (from === STATUS_DISPATCH.ARRIVED ||
        from === STATUS_DISPATCH.READY) && isRider) {
      return;
    }
    throw new ForbiddenError(
      ticket.ticketType === "TOW" ?
        "Only the assigned tower completes the tow" :
        "Only the rider resolves a ticket",
    );
  }
  if (status === STATUS_DISPATCH.CANCELLED) {
    if (isRider && ticket.ticketType === "SOS" &&
      from === STATUS_DISPATCH.READY) {
      throw new ForbiddenError("The mobile shop has completed the fix");
    }
    if (isRider && from !== STATUS_DISPATCH.IN_PROGRESS &&
      from !== STATUS_DISPATCH.IN_SHOP) return;
    if ((isOperator || isAssignee) && ticket.ticketType === "TOW" &&
      (from === STATUS_DISPATCH.MATCHED || from === STATUS_DISPATCH.ARRIVED)) {
      return;
    }
    if (isOperator && ticket.ticketType === "SOS" &&
      from === STATUS_DISPATCH.MATCHED) {
      return;
    }
    throw new ForbiddenError(
      "Cannot cancel once work is underway",
    );
  }
  if (status === STATUS_DISPATCH.DECLINED) {
    if (from === STATUS_DISPATCH.PENDING &&
      ticket.ticketType === "WALK_IN" && isOperator) {
      return;
    }
    throw new ForbiddenError("Only the shop declines a walk-in");
  }
  throw new ValidationError("Invalid dispatch status");
};
