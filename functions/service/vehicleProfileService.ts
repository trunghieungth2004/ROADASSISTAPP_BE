import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import * as userRepository from "../repository/userRepository";
import * as providerRepository from "../repository/providerRepository";
import * as providerLocationRepository from
  "../repository/providerLocationRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as warrantyRepository from "../repository/warrantyRepository";
import * as vehicleHistoryRepository from
  "../repository/vehicleHistoryRepository";
import * as cacheManager from "../utils/cacheManager";
import {normalizeVehicleType} from "../utils/vehicleType";
import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../constants/status";

import {ConflictError, NotFoundError, ValidationError} from
  "../utils/errors";

const NS = "vehicleProfile";

const ensureUser = async (userId: string) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
};

const getProfiles = cacheManager.wrap(
  async (userId: string) => {
    await ensureUser(userId);
    const rows = await vehicleProfileRepository.findByUser(userId);
    for (const row of rows) {
      const normalized = normalizeVehicleType(row.type);
      if (normalized !== null && normalized !== row.type) {
        row.type = normalized;
        try {
          await vehicleProfileRepository.update(
            userId,
            row.id,
            {type: normalized},
          );
        } catch {
          continue;
        }
      }
    }
    return rows;
  },
  {namespace: NS, keyFn: (userId: string) => userId},
) as unknown as (userId: string) => Promise<Record<string, unknown>[]>;

const createProfile = async ({
  userId,
  type,
  baseWidth,
  baseHeight,
  label,
  plate,
}: {
  userId: string;
  type: string;
  baseWidth: number;
  baseHeight: number;
  label?: string;
  plate?: string;
}) => {
  await ensureUser(userId);
  const profile = await vehicleProfileRepository.create(userId, {
    type,
    baseWidth,
    baseHeight,
    ...(typeof label === "string" && label.trim() !== "" ?
      {label: label.trim()} : {}),
    ...(typeof plate === "string" && plate.trim() !== "" ?
      {plate: plate.trim().toUpperCase()} : {}),
  });
  cacheManager.del(NS, userId);
  return profile;
};

const updateProfile = async ({
  userId,
  profileId,
  label,
  plate,
  baseWidth,
  baseHeight,
}: {
  userId: string;
  profileId: string;
  label?: string;
  plate?: string;
  baseWidth?: number;
  baseHeight?: number;
}) => {
  await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  const fields: Record<string, unknown> = {};
  if (label !== undefined) fields.label = label.trim();
  if (plate !== undefined) fields.plate = plate.trim().toUpperCase();
  if (baseWidth !== undefined) fields.baseWidth = baseWidth;
  if (baseHeight !== undefined) fields.baseHeight = baseHeight;
  if (Object.keys(fields).length === 0) {
    throw new ValidationError("No vehicle changes supplied");
  }
  await vehicleProfileRepository.update(userId, profileId, fields);
  cacheManager.del(NS, userId);
  return vehicleProfileRepository.findById(userId, profileId);
};

const vehicleHistory = async ({
  userId,
  profileId,
  limit,
}: {
  userId: string;
  profileId: string;
  limit?: number;
}) => {
  await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  const capped = Math.min(limit ?? 50, 100);
  const tickets = await vehicleHistoryRepository.findByVehicleId(
    profileId,
    capped * 2,
  );
  const claims = await warrantyRepository.findByRider(userId, 300)
    .catch(() => []);
  const claimByLine = new Map(claims.map((claim) => [claim.lineId, claim]));
  const providerCache = new Map<string, Record<string, unknown> | null>();
  const providerFor = async (
    id: unknown,
  ): Promise<Record<string, unknown> | null> => {
    const key = typeof id === "string" && id !== "" ? id : "";
    if (key === "") return null;
    if (providerCache.has(key)) return providerCache.get(key) ?? null;
    const provider = await providerRepository.findById(key)
      .catch(() => null);
    const snapshot = provider === null ? null : {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      lat: provider.lat,
      lng: provider.lng,
      label: provider.label ?? null,
      status: provider.status,
      accepting: provider.accepting !== false,
      openHours: provider.openHours ?? null,
      vehicleClasses: provider.vehicleClasses ?? null,
      ratingAvg: provider.ratingAvg ?? 0,
      ratingCount: provider.ratingCount ?? 0,
      services: provider.services ?? null,
      towBaseFee: provider.towBaseFee ?? null,
      towPerKmFee: provider.towPerKmFee ?? null,
      callOutFee: provider.callOutFee ?? null,
      travelPerKmFee: provider.travelPerKmFee ?? null,
    };
    providerCache.set(key, snapshot);
    return snapshot;
  };
  const items: Array<Record<string, unknown>> = [];
  for (const ticket of tickets) {
    if (items.length >= capped) break;
    if (ticket.status !== STATUS_DISPATCH.RESOLVED) continue;
    if (ticket.ticketType === "TOW") continue;
    if (ticket.warrantyOfTicketId !== undefined &&
      ticket.warrantyOfTicketId !== null &&
      ticket.warrantyOfTicketId !== "") continue;
    const source = Array.isArray(ticket.invoiceItems) &&
      ticket.invoiceItems.length > 0 ?
      ticket.invoiceItems :
      Array.isArray(ticket.quoteItems) ? ticket.quoteItems : [];
    const lines = (source as Array<Record<string, unknown>>).filter((line) => {
      return line.kind === "SERVICE";
    }).map((line) => {
      const row = line;
      const lineId = typeof row.lineId === "string" ? row.lineId : "";
      const claim = lineId === "" ? null : claimByLine.get(lineId) ?? null;
      return {
        lineId,
        serviceCode: typeof row.serviceCode === "string" ?
          row.serviceCode : "",
        name: typeof row.name === "string" ? row.name : "",
        qty: typeof row.qty === "number" ? row.qty : 1,
        amount: typeof row.amount === "number" ? row.amount : 0,
        warrantyUntil: typeof row.warrantyUntil === "string" ?
          row.warrantyUntil : null,
        claim: claim === null ? null : {
          id: claim.id,
          status: claim.status,
          shopResponse: claim.shopResponse,
          linkedTicketId: claim.linkedTicketId,
          refundAmount: claim.refundAmount,
          refundRequestId: claim.refundRequestId,
          createdAt: claim.createdAt,
        },
      };
    });
    if (lines.length === 0) continue;
    const providerId = ticket.assignedShopId ?? ticket.providerId ?? null;
    const provider = await providerFor(providerId);
    items.push({
      ticketId: ticket.id,
      ticketType: ticket.ticketType,
      serviceDate: ticket.deliveredAt ?? ticket.createdAt ?? null,
      providerName: typeof provider?.name === "string" ? provider.name : null,
      provider,
      total: lines.reduce((sum: number, line) => sum + line.amount, 0),
      lines,
    });
  }
  return {profileId, items};
};

const removeProfile = async ({
  userId,
  profileId,
}: {
  userId: string;
  profileId: string;
}) => {
  const user = await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  const linked = await providerRepository.findByVehicleProfileId(profileId);
  for (const provider of linked) {
    let active: Array<{id: string}> =
      (await dispatchRepository.findActiveForShop(provider.id)) ?? [];
    if (provider.kind === PROVIDER_KIND.SHOP) {
      const pending = await dispatchRepository.findPendingForShop(provider.id);
      const destination = await dispatchRepository.findActiveForDestination(
        provider.id,
      );
      active = [...active, ...pending, ...destination];
    }
    if (active.length > 0) {
      throw new ConflictError("Vehicle is on an active ticket", {
        ticketId: active[0].id,
      });
    }
  }
  const now = new Date().toISOString();
  for (const provider of linked) {
    await providerRepository.update(provider.id, {
      status: PROVIDER_STATUS.DENIED,
      accepting: false,
      vehicleProfileId: null,
      reviewedBy: userId,
      reviewNote: "Vehicle removed by operator",
      decidedAt: now,
    });
    await providerLocationRepository.remove(provider.id);
  }
  await vehicleProfileRepository.remove(userId, profileId);
  if (user.activeVehicleId === profileId) {
    await userRepository.updateActiveVehicle(userId, null);
  }
  cacheManager.del(NS, userId);
  cacheManager.del("provider");
  return {removed: true, revokedProviders: linked.map((p) => p.id)};
};

const addRideConfig = async ({
  userId,
  profileId,
  configType,
  estWidth,
  estHeight,
}: {
  userId: string;
  profileId: string;
  configType: string;
  estWidth?: number;
  estHeight?: number;
}) => {
  await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  const config = await vehicleProfileRepository.addRideConfig(
    userId,
    profileId,
    {
      configType,
      estWidth,
      estHeight,
    },
  );
  cacheManager.del(NS, userId);
  return config;
};


export {
  getProfiles,
  createProfile,
  updateProfile,
  vehicleHistory,
  removeProfile,
  addRideConfig,
  ValidationError,
  NotFoundError,
};
