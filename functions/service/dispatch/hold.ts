import * as dispatchRepository from "../../repository/dispatchRepository";
import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import * as cacheManager from "../../utils/cacheManager";
import {
  DISPATCH_HOLD_ETA_GRACE_MINUTES,
  DISPATCH_HOLD_ETA_MAX_HOURS,
  DISPATCH_HOLD_LABEL,
  DISPATCH_HOLD_NOTE_MAX,
  DISPATCH_HOLD_REASONS,
} from "../../constants/dispatch";
import {STATUS_DISPATCH} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors";
import {enqueueDispatchPush} from "../taskQueueService";
import {chatService} from "../chatService";

const NS = "dispatch";

const HOLDABLE = new Set<string>([
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.ARRIVED,
  STATUS_DISPATCH.IN_PROGRESS,
  STATUS_DISPATCH.IN_SHOP,
  STATUS_DISPATCH.QUOTED,
  STATUS_DISPATCH.FINAL_QUOTED,
  STATUS_DISPATCH.ESTIMATED,
  STATUS_DISPATCH.EST_APPROVED,
  STATUS_DISPATCH.READY,
]);

const operatorUidsFor = async (
  ticket: Record<string, unknown>,
): Promise<string[]> => {
  const ids = [ticket.assignedShopId, ticket.providerId].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
  const out: string[] = [];
  for (const id of ids) {
    const provider = await providerRepository.findById(id);
    if (provider && typeof provider.operatorUid === "string") {
      out.push(provider.operatorUid);
    }
  }
  return out;
};

const setHold = async (input: {
  userId: string;
  ticketId: string;
  reason: string;
  note?: string;
  etaAt?: string;
}): Promise<Record<string, unknown>> => {
  const ticket = await dispatchRepository.findById(input.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (!(DISPATCH_HOLD_REASONS as readonly string[]).includes(input.reason)) {
    throw new ValidationError("Unknown delay reason");
  }
  if (!HOLDABLE.has(ticket.status)) {
    throw new ValidationError("This job cannot be paused");
  }
  const caller = await userRepository.findById(input.userId);
  const operatorUids = await operatorUidsFor(ticket as never);
  const isRider = ticket.userId === input.userId;
  const isShop = operatorUids.includes(input.userId);
  if (!isRider && !isShop && caller?.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the rider or assigned shop sets delays");
  }
  const note = typeof input.note === "string" ?
    input.note.trim().slice(0, DISPATCH_HOLD_NOTE_MAX) :
    "";
  const etaAt = input.etaAt;
  if (etaAt !== undefined) {
    const at = Date.parse(etaAt);
    if (Number.isNaN(at)) throw new ValidationError("Invalid ETA");
    if (at < Date.now() - 60 * 1000 ||
      at > Date.now() + DISPATCH_HOLD_ETA_MAX_HOURS * 3600 * 1000) {
      throw new ValidationError("ETA is out of range");
    }
  }
  const hold = {
    reason: input.reason,
    note: note === "" ? null : note,
    etaAt: etaAt ?? null,
    by: input.userId,
    at: new Date().toISOString(),
  };
  await dispatchRepository.update(ticket.id, {hold});
  cacheManager.del(NS);
  const label = DISPATCH_HOLD_LABEL[input.reason] ?? "Delayed";
  const etaLabel = typeof etaAt === "string" ?
    new Date(etaAt).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    }) :
    null;
  const details = [note, etaLabel === null ? "" : `New ETA ${etaLabel}`]
    .filter((part) => part !== "")
    .join(" · ");
  const chatText = details === "" ? label : `${label} · ${details}`;
  await chatService.addSystemEvent(
    ticket.id,
    `Delay reported: ${chatText}`,
    "DELAY_REPORTED",
    {
      reason: input.reason,
      ...(note === "" ? {} : {note}),
      ...(etaAt === undefined ? {} : {etaAt}),
    },
  ).catch(() => undefined);
  if (isShop) {
    await enqueueDispatchPush(ticket.id, "-hold", {
      audience: "rider",
      title: label,
      body: details === "" ? "Your helper posted a delay" : details,
    }).catch(() => undefined);
  } else if (isRider) {
    await enqueueDispatchPush(ticket.id, "-hold", {
      audience: "operator",
      title: "Rider reported a delay",
      body: details === "" ? label : `${label} · ${details}`,
    }).catch(() => undefined);
  }
  return {...ticket, hold};
};

const sweepExpiredHolds = async (): Promise<{cleared: number}> => {
  const cutoff = new Date(
    Date.now() - DISPATCH_HOLD_ETA_GRACE_MINUTES * 60 * 1000,
  ).toISOString();
  const tickets = await dispatchRepository.findExpiredHolds(cutoff, 200);
  let cleared = 0;
  for (const ticket of tickets) {
    const hold = ticket.hold;
    if (!hold || typeof hold !== "object") continue;
    const etaAt = typeof hold.etaAt === "string" ? hold.etaAt : "";
    if (etaAt === "") continue;
    await dispatchRepository.update(ticket.id, {hold: null});
    const by = typeof hold.by === "string" ? hold.by : "";
    const riderReported = by === ticket.userId;
    await chatService.addSystemEvent(
      ticket.id,
      "Delay cleared — new ETA passed",
      "DELAY_CLEARED",
      {automatic: "true"},
    ).catch(() => undefined);
    await enqueueDispatchPush(
      ticket.id,
      `-hold-expired-${ticket.id}`,
      {
        audience: riderReported ? "operator" : "rider",
        title: "Delay cleared",
        body: "The reported delay ETA has passed",
      },
    ).catch(() => undefined);
    cleared += 1;
  }
  if (cleared > 0) cacheManager.del(NS);
  return {cleared};
};

const clearHold = async (input: {
  userId: string;
  ticketId: string;
}): Promise<Record<string, unknown>> => {
  const ticket = await dispatchRepository.findById(input.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(input.userId);
  const hold = ticket.hold;
  if (!hold || typeof hold !== "object") {
    return {...ticket, hold: null};
  }
  const reporter = typeof hold.by === "string" ? hold.by : "";
  if (reporter !== input.userId && caller?.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the reporter clears this delay");
  }
  const riderReported = ticket.userId === reporter;
  await dispatchRepository.update(ticket.id, {hold: null});
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticket.id,
    "Delay cleared",
    "DELAY_CLEARED",
  ).catch(() => undefined);
  await enqueueDispatchPush(ticket.id, "-hold-clear", {
    audience: riderReported ? "operator" : "rider",
    title: "Delay cleared",
    body: "Work is moving again",
  }).catch(() => undefined);
  return {...ticket, hold: null};
};

export {setHold, clearHold, sweepExpiredHolds};
