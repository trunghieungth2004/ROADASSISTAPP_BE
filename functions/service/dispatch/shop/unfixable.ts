import {tryRefundPayment, tryVoidPendingPayments} from "./helpers";
import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {enqueueDispatchPush} from "../../taskQueueService";

import {stopWaiting} from "../waiting";
import {NS, UNFIX_GRACE_MS} from "../constants";


import {STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";


import {continueSos} from "../sos";
import {mobileTowAvailabilityFor} from "../summary";
import {chatService} from "../../chatService";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";
import {validatePhotoPaths} from "../../../utils/media";
import {DISPATCH_PHOTO_PREFIX} from "../../../constants/media";


export const markUnfixable = async ({
  userId,
  ticketId,
  reason,
  photoUrls,
}: {
  userId: string;
  ticketId: string;
  reason: string;
  photoUrls: string[];
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  let isOperator = false;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      break;
    }
  }
  if (!isOperator && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator marks unfixable");
  }
  const allowed: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.IN_PROGRESS,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.FINAL_QUOTED,
    STATUS_DISPATCH.QUOTED,
    STATUS_DISPATCH.ARRIVED,
  ]);
  if (!allowed.has(ticket.status)) {
    throw new ValidationError("Ticket is not in an unfixable state");
  }
  if (ticket.ticketType === "SOS" &&
    ticket.status !== STATUS_DISPATCH.ARRIVED) {
    throw new ValidationError("Arrive at the rider before marking unfixable");
  }
  if (ticket.disputeHold === true) {
    throw new ValidationError("Dispute under review");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new ValidationError("Reason is required");
  }
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    throw new ValidationError("Evidence photos are required");
  }
  const paths = validatePhotoPaths({
    paths: photoUrls,
    ownerUid: userId,
    prefix: DISPATCH_PHOTO_PREFIX,
    ticketId,
  });
  const nowIso = new Date().toISOString();
  await dispatchRepository.update(ticketId, {
    unfixable: {
      reason,
      photoUrls: paths,
      by: userId,
      at: nowIso,
    },
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.UNFIXABLE,
    userId,
  );
  try {
    await stopWaiting(ticketId);
  } catch {
    void 0;
  }
  if (ticket.ticketType !== "SOS") {
    await tryVoidPendingPayments(ticketId);
    await tryRefundPayment(ticketId, userId);
  }
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    `Vehicle marked unfixable (${reason}). ` +
      `${paths.length} evidence photo(s).`,
    "UNFIXABLE",
    {reason, photos: paths.length},
  );
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.UNFIXABLE}`, {
    audience: "rider",
    urgent: "true",
    title: "Marked unfixable",
    body: "The shop marked your vehicle unfixable — tap to view",
  });
  if (ticket.ticketType === "SOS") {
    try {
      const availability = await mobileTowAvailabilityFor(ticket);
      if (!availability.available) {
        const fresh = await dispatchRepository.findById(ticketId);
        if (fresh) {
          const continuation = await continueSos({
            userId: fresh.userId,
            ticketId,
            auto: true,
          });
          if (continuation.ticketId !== undefined) {
            return {
              unfixable: true,
              continuationTicketId: continuation.ticketId,
            };
          }
          if (continuation.noCandidates === true) {
            await enqueueDispatchPush(ticketId, "-unfix-no-candidates", {
              audience: "rider",
              urgent: "true",
              title: "No other mobile shops nearby",
              body: "Request a tow instead.",
            });
            return {unfixable: true, noCandidates: true};
          }
          if (continuation.requiresContinuationConfirmation === true) {
            await enqueueDispatchPush(ticketId, "-unfix-continue-rider", {
              audience: "rider",
              urgent: "true",
              title: "Request another mobile shop",
              body: "Tap to request another mobile shop.",
            });
            return {
              unfixable: true,
              requiresContinuationConfirmation: true,
              nextAttempt: continuation.nextAttempt,
              callOutTotal: continuation.callOutTotal,
            };
          }
        }
      } else {
        await dispatchRepository.update(ticketId, {
          unfixGraceAt: nowIso,
        });
        const graceAt = new Date(
          Date.now() + UNFIX_GRACE_MS,
        ).toISOString();
        await enqueueDispatchPush(
          ticketId,
          `-unfix-grace-${Date.parse(nowIso)}`,
          {action: "unfix-grace", offerAt: nowIso},
          graceAt,
        );
      }
    } catch {
      void 0;
    }
  }
  return {unfixable: true};
};
