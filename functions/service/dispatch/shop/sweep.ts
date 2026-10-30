import * as dispatchRepository from "../../../repository/dispatchRepository";


import {enqueueDispatchPush} from "../../taskQueueService";


import {LATE_GRACE_MS, NS} from "../constants";


import {STATUS_DISPATCH} from "../../../constants/status";


import * as cacheManager from "../../../utils/cacheManager";


export const sweepLateTows = async (): Promise<{notified: number}> => {
  const tickets = await dispatchRepository.findByStatusForTypes(
    STATUS_DISPATCH.MATCHED,
    ["TOW"],
  );
  const now = Date.now();
  let notified = 0;
  for (const ticket of tickets) {
    if (typeof ticket.etaPickupAt !== "string") continue;
    if (typeof ticket.etaNotifiedAt === "string") continue;
    if (Date.parse(ticket.etaPickupAt) + LATE_GRACE_MS > now) continue;
    await dispatchRepository.update(ticket.id, {
      etaNotifiedAt: new Date().toISOString(),
    });
    await enqueueDispatchPush(ticket.id, "-late-rider", {
      title: "Driver delayed",
      body: "Your tow is running late — tap to view",
    });
    await enqueueDispatchPush(ticket.id, "-late-operator", {
      audience: "operator",
      title: "Pickup running late",
      body: "This pickup is past its ETA — tap to view",
    });
    notified += 1;
  }
  if (notified > 0) cacheManager.del(NS);
  return {notified};
};
