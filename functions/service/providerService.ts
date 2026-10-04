import * as providerRepository from "../repository/providerRepository";
import * as providerReportRepository from
  "../repository/providerReportRepository";
import * as providerLocationRepository from
  "../repository/providerLocationRepository";
import * as userRepository from "../repository/userRepository";
import {normalizeTowPlate} from "../repository/providerRepository";
import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  encodeGeohash,
  haversineMeters,
} from "../utils/geo";
import {
  NEAR_SHOPS_MAX,
  PROVIDER_KIND,
  PROVIDER_REPORT_REASON,
  PROVIDER_REPORT_STATUS,
  PROVIDER_STATUS,
} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";

import {ConflictError, ForbiddenError, NotFoundError, ValidationError} from
  "../utils/errors";
import * as cacheManager from "../utils/cacheManager";

const PLATE_SHAPE = /^\d{2}[A-Z0-9]{1,3}\d{4,6}$/;
const SHOP_NS = "shop";
const PROVIDER_NS = "provider";

const DOW_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const parseSchedule = (
  openHours: string,
): Array<{day: string; open: number; close: number}> => {
  const trimmed = openHours.trim();
  const normalized = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(trimmed) ?
    DOW_KEYS.map((d) => `${d} ${trimmed}`).join(",") :
    openHours;
  const out: Array<{day: string; open: number; close: number}> = [];
  for (const entry of normalized.split(",")) {
    const m = /^(MON|TUE|WED|THU|FRI|SAT|SUN) (\d{2}):(\d{2})-(\d{2}):(\d{2})$/
      .exec(entry.trim());
    if (!m) continue;
    const open = Number(m[2]) * 60 + Number(m[3]);
    const close = Number(m[4]) * 60 + Number(m[5]);
    if (Number(m[2]) > 23 || Number(m[3]) > 59) continue;
    if (Number(m[4]) > 23 || Number(m[5]) > 59) continue;
    out.push({day: m[1], open, close});
  }
  return out;
};

const isOpenNow = (
  openHours: string | null | undefined,
  now: Date = new Date(),
): boolean | null => {
  if (!openHours) return null;
  const entries = parseSchedule(openHours);
  if (entries.length === 0) return null;
  const dayIdx = now.getDay();
  const today = DOW_KEYS[dayIdx] ?? "";
  const yesterday = DOW_KEYS[(dayIdx + 6) % 7] ?? "";
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const e of entries) {
    if (e.day === today) {
      if (e.open <= e.close) {
        if (cur >= e.open && cur < e.close) return true;
      } else if (cur >= e.open) {
        return true;
      }
    }
    if (e.open > e.close && e.day === yesterday && cur < e.close) {
      return true;
    }
  }
  return false;
};

const createShopProvider = async ({
  userId,
  name,
  lat,
  lng,
  label,
  openHours,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  openHours?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const operated = await providerRepository.findByOperator(userId);
  if (operated.some((p) => p.kind === PROVIDER_KIND.SHOP)) {
    throw new ConflictError("A shop provider already exists");
  }
  const created = await providerRepository.createShop({
    operatorUid: userId,
    name,
    lat,
    lng,
    label,
    openHours,
  });
  cacheManager.del(PROVIDER_NS, userId);
  cacheManager.del(SHOP_NS);
  return created;
};

const createTowProvider = async ({
  userId,
  name,
  lat,
  lng,
  label,
  plate,
  vehicleType,
  vehicleWidth,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  plate: string;
  vehicleType: string;
  vehicleWidth?: number;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!plate || typeof plate !== "string") {
    throw new ValidationError("Plate number is required");
  }
  if (!vehicleType || typeof vehicleType !== "string") {
    throw new ValidationError("Vehicle type is required");
  }
  const normalized = normalizeTowPlate(plate);
  if (!PLATE_SHAPE.test(normalized)) {
    throw new ValidationError("Plate number has an invalid shape");
  }
  const operated = await providerRepository.findByOperator(userId);
  if (operated.some((p) => p.kind === PROVIDER_KIND.TOW &&
    p.status !== PROVIDER_STATUS.DENIED)) {
    throw new ConflictError("A tow provider already exists");
  }
  const existing = await providerRepository.findByPlate(normalized);
  if (existing) {
    throw new ConflictError("This plate is already registered");
  }
  try {
    const created = await providerRepository.createTow({
      operatorUid: userId,
      name,
      lat,
      lng,
      label,
      plate: normalized,
      plateRaw: plate.trim(),
      vehicleType,
      vehicleWidth,
    });
    cacheManager.del(PROVIDER_NS, userId);
    cacheManager.del(SHOP_NS);
    return created;
  } catch (error) {
    const code = (error as {code?: number | string} | null)?.code;
    const message = error instanceof Error ? error.message : "";
    if (code === 6 || code === "already-exists" ||
      /already exists/i.test(message)) {
      throw new ConflictError("This plate is already registered");
    }
    throw error;
  }
};

const updateProvider = async ({
  userId,
  providerId,
  fields,
}: {
  userId: string;
  providerId: string;
  fields: {
    name?: string;
    label?: string | null;
    openHours?: string | null;
    accepting?: boolean;
    lat?: number;
    lng?: number;
  };
}) => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = provider.operatorUid as string | null;
  if (operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates this provider");
  }
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) {
    patch.name = fields.name;
    patch.nameLower = fields.name.trim().toLowerCase();
  }
  if (fields.label !== undefined) patch.label = fields.label;
  if (fields.openHours !== undefined) patch.openHours = fields.openHours;
  if (fields.accepting !== undefined) patch.accepting = fields.accepting;
  if (fields.lat !== undefined || fields.lng !== undefined) {
    if (typeof fields.lat !== "number" || typeof fields.lng !== "number") {
      throw new ValidationError("Location needs both lat and lng");
    }
    patch.lat = fields.lat;
    patch.lng = fields.lng;
    patch.geoHash = encodeGeohash(fields.lat, fields.lng, 8);
    patch.geoCell = encodeGeohash(fields.lat, fields.lng, 6);
  }
  await providerRepository.update(providerId, patch);
  if (fields.accepting === false) {
    await providerLocationRepository.remove(providerId);
  }
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {updated: 1};
};

const myProvidersInner = async ({userId}: {userId: string}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return providerRepository.findByOperator(userId);
};

const myProvidersCached = cacheManager.wrap(myProvidersInner, {
  namespace: PROVIDER_NS,
  keyFn: ({userId}: {userId: string}) => userId,
});

const myProviders = async ({userId}: {userId: string}) =>
  myProvidersCached({userId});

const nearProvidersInner = async ({
  lat,
  lng,
  kind,
  radiusMeters = 2000,
  acceptingOnly = false,
  openOnly = false,
  limit = NEAR_SHOPS_MAX,
  now,
}: {
  lat: number;
  lng: number;
  kind?: string;
  radiusMeters?: number;
  acceptingOnly?: boolean;
  openOnly?: boolean;
  limit?: number;
  now?: Date;
}) => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const found = await providerRepository.findByGeohashPrefixes(
    cellsCoveringBounds(bounds, 6),
  );
  const at = now ?? new Date();
  let filtered = found
    .filter((s) => s.status === PROVIDER_STATUS.ACTIVE &&
      (s as {suspended?: boolean}).suspended !== true)
    .map((s) => {
      const distance = haversineMeters(
        lat,
        lng,
        s.lat as number,
        s.lng as number,
      );
      const openNow = isOpenNow(s.openHours as string | null, at);
      return {...s, distance, openNow};
    })
    .filter((s) => (s.distance as number) <= radiusMeters);
  if (kind) filtered = filtered.filter((s) => s.kind === kind);
  if (acceptingOnly) {
    filtered = filtered.filter((s) => s.accepting !== false);
  }
  if (openOnly) filtered = filtered.filter((s) => s.openNow === true);
  filtered.sort((a, b) => (a.distance as number) - (b.distance as number));
  return filtered.slice(0, limit);
};

const nearProvidersCached = cacheManager.wrap(nearProvidersInner, {
  namespace: SHOP_NS,
  keyFn: ({
    lat,
    lng,
    kind,
    radiusMeters = 2000,
    acceptingOnly = false,
    openOnly = false,
    limit = NEAR_SHOPS_MAX,
  }: {
    lat: number;
    lng: number;
    kind?: string;
    radiusMeters?: number;
    acceptingOnly?: boolean;
    openOnly?: boolean;
    limit?: number;
    now?: Date;
  }) =>
    `${lat.toFixed(3)},${lng.toFixed(3)},${kind ?? "-"},` +
    `${radiusMeters},${acceptingOnly ? "1" : "0"},` +
    `${openOnly ? "1" : "0"},${limit}`,
});

const nearProviders = async ({
  lat,
  lng,
  kind,
  radiusMeters = 2000,
  acceptingOnly = false,
  openOnly = false,
  limit = NEAR_SHOPS_MAX,
  now,
}: {
  lat: number;
  lng: number;
  kind?: string;
  radiusMeters?: number;
  acceptingOnly?: boolean;
  openOnly?: boolean;
  limit?: number;
  now?: Date;
}) =>
  nearProvidersCached({
    lat,
    lng,
    kind,
    radiusMeters,
    acceptingOnly,
    openOnly,
    limit,
    now,
  });

const listPending = async (adminUid?: string) => {
  if (adminUid) {
    const caller = await userRepository.findById(adminUid);
    if (!caller) throw new NotFoundError("User not found");
    if (caller.role !== ROLE_ADMIN) {
      throw new ForbiddenError("Admin role required");
    }
  }
  const pending = await providerRepository.findPending();
  const out = [];
  for (const item of pending) {
    const applicant = await userRepository.findById(item.operatorUid ?? "");
    const openReportCount =
      await providerReportRepository.countOpenForProvider(item.id);
    out.push({
      ...item,
      applicantEmail: applicant?.email ?? null,
      applicantName: applicant?.displayName ?? null,
      openReportCount,
    });
  }
  return out;
};

const reviewProvider = async ({
  adminUid,
  providerId,
  approve,
  reviewNote,
}: {
  adminUid: string;
  providerId: string;
  approve: boolean;
  reviewNote?: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const existing = await providerRepository.findById(providerId);
  if (!existing) throw new NotFoundError("Provider not found");
  const decided = await providerRepository.decide(providerId, {
    status: approve ? PROVIDER_STATUS.ACTIVE : PROVIDER_STATUS.DENIED,
    reviewedBy: adminUid,
    reviewNote,
  });
  if (!decided) {
    return {decided: false, status: existing.status};
  }
  if (!approve) {
    await providerLocationRepository.remove(providerId);
  }
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {
    decided: true,
    status: approve ? PROVIDER_STATUS.ACTIVE : PROVIDER_STATUS.DENIED,
  };
};

const reportProvider = async ({
  userId,
  providerId,
  reason,
  note,
  ticketId,
}: {
  userId: string;
  providerId: string;
  reason: string;
  note?: string;
  ticketId?: string;
}) => {
  const reporter = await userRepository.findById(userId);
  if (!reporter) throw new NotFoundError("User not found");
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  if (provider.status !== PROVIDER_STATUS.ACTIVE ||
    (provider as {suspended?: boolean}).suspended === true) {
    throw new ValidationError("Only active providers can be reported");
  }
  if (!(Object.values(PROVIDER_REPORT_REASON) as string[]).includes(reason)) {
    throw new ValidationError("Unknown report reason");
  }
  const dupe = await providerReportRepository.findOpenByReporter(
    providerId,
    userId,
  );
  if (dupe) {
    throw new ConflictError(
      "You already have an open report for this provider",
    );
  }
  return providerReportRepository.create({
    providerId,
    providerKind: provider.kind,
    targetUid: (provider.operatorUid as string | null) ?? null,
    reportedBy: userId,
    ticketId,
    reason,
    note,
  });
};

const listReports = async (adminUid: string) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const reports = await providerReportRepository.listOpen();
  const out = [];
  for (const report of reports) {
    const provider = await providerRepository.findById(report.providerId);
    out.push({
      ...report,
      providerName: provider?.name ?? null,
      providerStatus: provider?.status ?? null,
      providerSuspended: (provider as {suspended?: boolean} | null)
        ?.suspended === true,
    });
  }
  return out;
};

const dismissReport = async ({
  adminUid,
  reportId,
}: {
  adminUid: string;
  reportId: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const report = await providerReportRepository.findById(reportId);
  if (!report) throw new NotFoundError("Report not found");
  const dismissed = await providerReportRepository.decide(reportId, {
    status: PROVIDER_REPORT_STATUS.DISMISSED,
    resolution: "NONE",
    decidedBy: adminUid,
  });
  return {dismissed};
};

const suspendProvider = async ({
  adminUid,
  providerId,
  reason,
  reportId,
}: {
  adminUid: string;
  providerId: string;
  reason?: string;
  reportId?: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const now = new Date().toISOString();
  await providerRepository.update(providerId, {
    suspended: true,
    suspendedAt: now,
    suspendedReason: reason ?? null,
    suspendedBy: adminUid,
  });
  await providerLocationRepository.remove(providerId);
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  let reportDecided: boolean | null = null;
  if (reportId) {
    const report = await providerReportRepository.findById(reportId);
    if (!report) throw new NotFoundError("Report not found");
    reportDecided = await providerReportRepository.decide(reportId, {
      status: PROVIDER_REPORT_STATUS.RESOLVED,
      resolution: "SUSPENDED",
      decidedBy: adminUid,
    });
  }
  return {suspended: true, reportDecided};
};

const restoreProvider = async ({
  adminUid,
  providerId,
}: {
  adminUid: string;
  providerId: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  if ((provider as {suspended?: boolean}).suspended !== true) {
    return {restored: false, suspended: false};
  }
  await providerRepository.update(providerId, {
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
  });
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {restored: true, suspended: false};
};

const updateProviderLocation = async ({
  userId,
  lat,
  lng,
}: {
  userId: string;
  lat: number;
  lng: number;
}) => {
  const operated = await providerRepository.findByOperator(userId);
  const tow = operated.find((p) => p.kind === PROVIDER_KIND.TOW);
  if (!tow) throw new NotFoundError("Tow provider not found");
  if (tow.status !== PROVIDER_STATUS.ACTIVE ||
    (tow as {suspended?: boolean}).suspended === true) {
    throw new ForbiddenError("Only active tow providers share location");
  }
  if (tow.accepting !== true) {
    throw new ForbiddenError("Location sharing needs accepting mode on");
  }
  await providerLocationRepository.upsert(tow.id, lat, lng);
  return {updated: 1, providerId: tow.id};
};

export {
  PLATE_SHAPE,
  createShopProvider,
  createTowProvider,
  updateProvider,
  myProviders,
  nearProviders,
  listPending,
  reviewProvider,
  reportProvider,
  listReports,
  dismissReport,
  suspendProvider,
  restoreProvider,
  updateProviderLocation,
  isOpenNow,
  NotFoundError,
  ForbiddenError,
};
