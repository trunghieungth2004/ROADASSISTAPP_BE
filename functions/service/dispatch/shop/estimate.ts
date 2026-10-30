import {requireDestinationShopOperator} from "./helpers";
import * as dispatchRepository from "../../../repository/dispatchRepository";


import {enqueueDispatchPush} from "../../taskQueueService";


import {NS, TOW_ESTIMATE_TTL_MS} from "../constants";


import {STATUS_DISPATCH} from "../../../constants/status";


import {chatService} from "../../chatService";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";


export const sendEstimate = async ({
  userId,
  ticketId,
  estimateAmount,
  estimateNote,
  eta,
}: {
  userId: string;
  ticketId: string;
  estimateAmount: number;
  estimateNote?: string;
  eta?: number;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "TOW") {
    throw new ValidationError("Estimates are for tow tickets");
  }
  await requireDestinationShopOperator(ticket, userId);
  const towStates: Set<string> = new Set([
    STATUS_DISPATCH.PENDING,
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
  ]);
  if (!towStates.has(ticket.status)) {
    throw new ValidationError("Estimates go out on active tows");
  }
  if (typeof ticket.estimateApprovedAt === "string" &&
    ticket.estimateApprovedAt !== "") {
    throw new ValidationError("Estimate already approved");
  }
  if (typeof ticket.estimateExpiresAt === "string" &&
    Date.parse(ticket.estimateExpiresAt) > Date.now()) {
    throw new ValidationError("Estimate already sent");
  }
  if (!Number.isInteger(estimateAmount) || estimateAmount < 0) {
    throw new ValidationError("Estimate must be a non-negative integer");
  }
  await dispatchRepository.update(ticketId, {
    estimateAmount,
    ...(estimateNote !== undefined ? {estimateNote} : {}),
    ...(eta !== undefined ? {estimateEta: eta} : {}),
    estimateExpiresAt: new Date(
      Date.now() + TOW_ESTIMATE_TTL_MS,
    ).toISOString(),
    estimateApprovedAt: null,
    estimateBy: userId,
    estimatedAt: new Date().toISOString(),
  });
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    `Repair estimate sent: ${estimateAmount} VND.`,
    "ESTIMATE_SENT",
    {amount: estimateAmount},
  );
  await enqueueDispatchPush(ticketId, "-estimate-sent-rider", {
    audience: "rider",
    title: "Repair estimate ready",
    body: "The drop-off shop sent an estimate — tap to review",
  });
  return {estimated: true};
};

export const approveEstimate = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider approves the estimate");
  }
  if (ticket.ticketType === "TOW") {
    if (typeof ticket.estimateAmount !== "number") {
      throw new ValidationError("No estimate awaiting approval");
    }
    if (typeof ticket.estimateApprovedAt === "string" &&
      ticket.estimateApprovedAt !== "") {
      throw new ValidationError("Estimate already approved");
    }
    if (typeof ticket.estimateExpiresAt === "string" &&
      Date.parse(ticket.estimateExpiresAt) <= Date.now()) {
      throw new ValidationError("Estimate expired");
    }
    await dispatchRepository.update(ticketId, {
      estimateApprovedAt: new Date().toISOString(),
    });
    cacheManager.del(NS);
    await enqueueDispatchPush(
      ticketId,
      "-estimate-approved-destination",
      {
        audience: "destination-shop",
        title: "Estimate approved",
        body: "The rider approved your estimate — hold the bay",
      },
    );
    return {approved: true};
  }
  if (ticket.status !== STATUS_DISPATCH.ESTIMATED) {
    throw new ValidationError("No estimate awaiting approval");
  }
  if (typeof ticket.estimateExpiresAt === "string" &&
    Date.parse(ticket.estimateExpiresAt) <= Date.now()) {
    throw new ValidationError("Estimate expired");
  }
  await dispatchRepository.update(ticketId, {
    estimateApprovedAt: new Date().toISOString(),
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.EST_APPROVED,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "The rider approved the estimate.",
    "ESTIMATE_APPROVED",
  );
  await enqueueDispatchPush(
    ticketId,
    `-status-${STATUS_DISPATCH.EST_APPROVED}-operator`,
    {
      audience: "operator",
      title: "Estimate approved",
      body: "The rider authorized the tow and drop-off — tap to view",
    },
  );
  return {approved: true};
};

export const declineEstimate = async ({
  userId,
  ticketId,
  shopId,
}: {
  userId: string;
  ticketId: string;
  shopId?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider declines the estimate");
  }
  if (ticket.ticketType === "TOW") {
    if (typeof ticket.estimateAmount !== "number") {
      throw new ValidationError("No estimate awaiting decision");
    }
    let declinedId = typeof shopId === "string" && shopId !== "" ? shopId : "";
    if (declinedId === "") {
      if (typeof ticket.destinationShopId === "string" &&
        ticket.destinationShopId !== "") {
        declinedId = ticket.destinationShopId;
      } else if (typeof ticket.suggestedShopId === "string" &&
        ticket.suggestedShopId !== "") {
        declinedId = ticket.suggestedShopId;
      }
    }
    const patch: Record<string, unknown> = {
      estimateAmount: null,
      estimateNote: null,
      estimateExpiresAt: null,
      estimateApprovedAt: null,
    };
    if (declinedId !== "" && typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId === declinedId) {
      patch.destinationShopId = null;
      patch.destinationSnapshot = null;
      patch.destinationPoint = null;
      patch.needsNewDestination = true;
    }
    if (declinedId !== "") {
      const prior = Array.isArray(ticket.declinedShopIds) ?
        [...(ticket.declinedShopIds as string[])] :
        [];
      if (!prior.includes(declinedId)) prior.push(declinedId);
      patch.declinedShopIds = prior;
    }
    await dispatchRepository.update(ticketId, patch);
    cacheManager.del(NS);
    if (declinedId !== "") {
      await enqueueDispatchPush(ticketId, "-estimate-declined-destination", {
        audience: "destination-shop",
        shopId: declinedId,
        title: "Estimate declined",
        body: "The rider declined — pick another drop-off",
      });
    }
    return {declined: true};
  }
  if (ticket.status !== STATUS_DISPATCH.ESTIMATED) {
    throw new ValidationError("No estimate awaiting decision");
  }
  let declinedId = typeof shopId === "string" && shopId !== "" ? shopId : "";
  if (declinedId === "") {
    if (typeof ticket.suggestedShopId === "string" &&
      ticket.suggestedShopId !== "") {
      declinedId = ticket.suggestedShopId;
    } else if (typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId !== "") {
      declinedId = ticket.destinationShopId;
    } else if (typeof ticket.estimateBy === "string" &&
      ticket.estimateBy !== "") {
      declinedId = "";
    }
  }
  const patch: Record<string, unknown> = {
    status: STATUS_DISPATCH.PENDING,
    estimateExpiresAt: null,
  };
  if (declinedId !== "" && typeof ticket.suggestedShopId === "string" &&
    ticket.suggestedShopId === declinedId) {
    patch.suggestedShopId = null;
  }
  if (declinedId !== "" && typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId === declinedId) {
    patch.destinationShopId = null;
    patch.destinationSnapshot = null;
    patch.destinationPoint = null;
  }
  if (declinedId !== "") {
    const prior = Array.isArray(ticket.declinedShopIds) ?
      [...(ticket.declinedShopIds as string[])] :
      [];
    if (!prior.includes(declinedId)) prior.push(declinedId);
    patch.declinedShopIds = prior;
  }
  await dispatchRepository.update(ticketId, patch);
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.PENDING,
    userId,
  );
  cacheManager.del(NS);
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length > 0) {
    await enqueueDispatchPush(ticketId, "-estimate-declined-operator", {
      audience: "operator",
      title: "Estimate declined",
      body: "The rider declined the estimate — tap to view",
    });
  }
  return {declined: true};
};

