import * as providerRepository from "../../repository/providerRepository";
import * as dispatchRepository from "../../repository/dispatchRepository";

import * as providerLocationRepository from
  "../../repository/providerLocationRepository";


import {accrue} from "../dispatch/waiting";

import {PROVIDER_KIND, PROVIDER_STATUS} from "../../constants/status";


import {ForbiddenError, NotFoundError} from "../../utils/errors";


export const updateProviderLocation = async ({
  userId,
  lat,
  lng,
}: {
  userId: string;
  lat: number;
  lng: number;
}) => {
  const operated = await providerRepository.findByOperator(userId);
  const sharing = operated.filter((p) =>
    p.kind === PROVIDER_KIND.TOW ||
    p.kind === PROVIDER_KIND.MOBILE_SHOP);
  if (sharing.length === 0) {
    throw new NotFoundError("Mobile provider not found");
  }
  let updated = 0;
  let providerId: string | null = null;
  for (const provider of sharing) {
    if (provider.status !== PROVIDER_STATUS.ACTIVE ||
      (provider as {suspended?: boolean}).suspended === true) {
      continue;
    }
    if (provider.accepting !== true) {
      const holding = await dispatchRepository.findActiveForShop(provider.id);
      if (holding.length === 0) continue;
    }
    await providerLocationRepository.upsert(provider.id, lat, lng);
    updated += 1;
    if (providerId === null) providerId = provider.id;
    const active = await dispatchRepository.findActiveForShop(provider.id);
    for (const ticket of active) {
      if (ticket.ticketType !== "TOW" && ticket.ticketType !== "SOS") {
        continue;
      }
      try {
        await dispatchRepository.appendJobTrack(ticket.id, {
          lat,
          lng,
          at: new Date().toISOString(),
        });
      } catch {
        continue;
      }
      if (provider.kind !== PROVIDER_KIND.TOW) continue;
      const waiting = ticket.waiting as {active?: unknown} | null | undefined;
      if (!waiting || waiting.active !== true) continue;
      try {
        await accrue({
          ticketId: ticket.id,
          towerLat: lat,
          towerLng: lng,
          riderLat: ticket.lat,
          riderLng: ticket.lng,
        });
      } catch {
        continue;
      }
    }
  }
  if (updated === 0) {
    throw new ForbiddenError("Location sharing needs accepting mode on");
  }
  return {...(providerId !== null ? {providerId} : {}), updated};
};
