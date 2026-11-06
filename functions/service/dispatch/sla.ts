import * as dispatchRepository from "../../repository/dispatchRepository";
import {findCandidates, findTowOperators} from "./candidates";
import {enqueueDispatchPush} from "../taskQueueService";
import {
  MOBILE_SHOP_DEFAULT_RADIUS,
  TOW_DISPATCH_RADIUS,
} from "../../constants/status";
import {
  DISPATCH_MAX_RADIUS_M,
  DISPATCH_MAX_ROUNDS,
  DISPATCH_RADIUS_GROWTH,
  DISPATCH_SLA_MINUTES,
} from "../../constants/dispatch";

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ?
    value.filter((item): item is string => typeof item === "string") :
    [];

export const sweepDispatchSla = async (): Promise<{
  rebroadcast: number;
  breached: number;
}> => {
  const due = await dispatchRepository.findDueForSla(new Date().toISOString());
  let rebroadcast = 0;
  let breached = 0;
  for (const ticket of due) {
    if (ticket.ticketType !== "TOW" && ticket.ticketType !== "SOS") {
      continue;
    }
    if (ticket.addressedTow === true) continue;
    const round = typeof ticket.dispatchRound === "number" ?
      ticket.dispatchRound :
      1;
    const notified = strArray(ticket.notifiedOperatorUids);
    const currentRadius = typeof ticket.dispatchRadiusMeters === "number" ?
      ticket.dispatchRadiusMeters :
      ticket.ticketType === "TOW" ?
        TOW_DISPATCH_RADIUS :
        MOBILE_SHOP_DEFAULT_RADIUS;
    if (round >= DISPATCH_MAX_ROUNDS) {
      if (ticket.slaBreachedAt === undefined ||
        ticket.slaBreachedAt === null) {
        await dispatchRepository.update(ticket.id, {
          slaBreachedAt: new Date().toISOString(),
        });
        await enqueueDispatchPush(ticket.id, "-sla-breach", {
          audience: "rider",
          title: "No helper yet",
          body: "No one has accepted yet — widen the search or cancel.",
        }).catch(() => undefined);
        breached += 1;
      }
      continue;
    }
    const radius = Math.min(
      DISPATCH_MAX_RADIUS_M,
      Math.round(currentRadius * DISPATCH_RADIUS_GROWTH),
    );
    const exclude = [
      ...strArray(ticket.excludedOperatorUids),
      ...notified,
    ];
    const found = ticket.ticketType === "TOW" ?
      await findTowOperators({
        lat: ticket.lat,
        lng: ticket.lng,
        radiusMeters: radius,
        vehicleType: ticket.vehicleType as string | undefined,
      }) :
      await findCandidates({
        lat: ticket.lat,
        lng: ticket.lng,
        radiusMeters: radius,
        vehicleType: ticket.vehicleType as string | undefined,
        excludeOperatorUids: exclude,
        ...(typeof ticket.symptom === "string" ?
          {serviceCategory: ticket.symptom} :
          {}),
      });
    const fresh = found.filter((uid) => !notified.includes(uid));
    if (fresh.length === 0) {
      if (ticket.slaBreachedAt === undefined ||
        ticket.slaBreachedAt === null) {
        await dispatchRepository.update(ticket.id, {
          slaBreachedAt: new Date().toISOString(),
        });
        await enqueueDispatchPush(ticket.id, "-sla-breach", {
          audience: "rider",
          title: "No helper yet",
          body: "No one has accepted yet — widen the search or cancel.",
        }).catch(() => undefined);
        breached += 1;
      }
      continue;
    }
    const slaMinutes = DISPATCH_SLA_MINUTES[ticket.ticketType] ?? 5;
    await dispatchRepository.update(ticket.id, {
      candidates: fresh,
      candidateTs: new Date().toISOString(),
      notifiedOperatorUids: [...notified, ...fresh],
      dispatchRound: round + 1,
      dispatchRadiusMeters: radius,
      acceptByAt: new Date(
        Date.now() + slaMinutes * 60 * 1000,
      ).toISOString(),
    });
    await enqueueDispatchPush(ticket.id, `-sla-${round + 1}`);
    rebroadcast += 1;
  }
  return {rebroadcast, breached};
};
