import * as dispatchRepository from "../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import {ROLE_ADMIN} from "../../constants/roles";
import {ForbiddenError, NotFoundError} from "../../utils/errors";
import {haversineMeters} from "../../utils/geo";
import {getConfig} from "../platformConfigService";
import {
  MS_PER_MIN,
  WAITING_BLOCK_MS,
  WAITING_CAP_MS,
  WAITING_GRACE_MS,
  WAITING_RADIUS_M,
  WAITING_RATE_PER_MIN,
} from "./constants";

type WaitingRules = {
  graceMs: number;
  capMs: number;
  ratePerMin: number;
  radiusM: number;
};

const defaultRules = (): WaitingRules => ({
  graceMs: WAITING_GRACE_MS,
  capMs: WAITING_CAP_MS,
  ratePerMin: WAITING_RATE_PER_MIN,
  radiusM: WAITING_RADIUS_M,
});

const waitingRules = async (): Promise<WaitingRules> => {
  const fallback = defaultRules();
  try {
    const cfg = await getConfig();
    const blockMinutes = WAITING_BLOCK_MS / MS_PER_MIN;
    const graceMinutes =
      typeof cfg.waitingGraceMinutes === "number" &&
      cfg.waitingGraceMinutes >= 0 ?
        cfg.waitingGraceMinutes :
        fallback.graceMs / MS_PER_MIN;
    const capMinutes =
      typeof cfg.waitingCapMinutes === "number" && cfg.waitingCapMinutes >= 0 ?
        cfg.waitingCapMinutes :
        fallback.capMs / MS_PER_MIN;
    const ratePerMin =
      typeof cfg.waitingRatePer15Min === "number" &&
      cfg.waitingRatePer15Min >= 0 ?
        cfg.waitingRatePer15Min / blockMinutes :
        fallback.ratePerMin;
    return {
      graceMs: graceMinutes * MS_PER_MIN,
      capMs: capMinutes * MS_PER_MIN,
      ratePerMin,
      radiusM: fallback.radiusM,
    };
  } catch {
    return fallback;
  }
};

const calcFee = (elapsedMs: number, rules: WaitingRules): number => {
  const billable = Math.min(
    Math.max(0, elapsedMs - rules.graceMs),
    rules.capMs,
  );
  return Math.ceil(billable / MS_PER_MIN) * rules.ratePerMin;
};

const towerWithinRange = async (
  assignedShopId: unknown,
  ticketLat: number,
  ticketLng: number,
  radiusM: number,
): Promise<boolean> => {
  if (typeof assignedShopId !== "string" || assignedShopId === "") {
    return false;
  }
  try {
    const fixes = await providerLocationRepository.findByIds([assignedShopId]);
    const fix = fixes.get(assignedShopId);
    if (!fix || typeof fix.lat !== "number" || typeof fix.lng !== "number") {
      return false;
    }
    return haversineMeters(fix.lat, fix.lng, ticketLat, ticketLng) <= radiusM;
  } catch {
    return false;
  }
};

const startWaiting = async (ticketId: string, at?: string): Promise<void> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return;
  const waiting = ticket.waiting as {
    active?: boolean;
  } | null | undefined;
  if (waiting && waiting.active === true) return;
  const startedAt =
    typeof at === "string" && at !== "" ? at : new Date().toISOString();
  await dispatchRepository.update(ticketId, {
    waiting: {
      active: true,
      startedAt,
      endedAt: null,
      fee: null,
      withinRadius: null,
      accruedAt: null,
    },
  });
};

const stopWaiting = async (ticketId: string): Promise<{fee: number}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {fee: 0};
  const waiting = ticket.waiting as {
    active?: boolean;
    startedAt?: string | null;
    fee?: unknown;
  } | null | undefined;
  if (!waiting || waiting.active !== true) {
    const existing = waiting?.fee;
    return {fee: typeof existing === "number" ? existing : 0};
  }
  const startedAt = typeof waiting.startedAt === "string" ?
    waiting.startedAt :
    null;
  const rules = await waitingRules();
  if (!startedAt) {
    await dispatchRepository.update(ticketId, {
      waiting: {
        active: false,
        startedAt: null,
        endedAt: new Date().toISOString(),
        fee: 0,
        withinRadius: null,
        accruedAt: null,
      },
    });
    return {fee: 0};
  }
  const nowMs = Date.now();
  const startMs = Date.parse(startedAt);
  const elapsedMs = Math.min(Math.max(0, nowMs - startMs), rules.capMs);
  const near = await towerWithinRange(
    ticket.assignedShopId,
    ticket.lat,
    ticket.lng,
    rules.radiusM,
  );
  const fee = near ? calcFee(elapsedMs, rules) : 0;
  const endMs = Math.min(nowMs, startMs + rules.capMs);
  const endedAt = new Date(endMs).toISOString();
  await dispatchRepository.update(ticketId, {
    waiting: {
      active: false,
      startedAt,
      endedAt,
      fee,
      withinRadius: near,
      accruedAt: endedAt,
    },
  });
  const towFare = ticket.towFare as Record<string, unknown> | null | undefined;
  if (towFare && typeof towFare === "object") {
    await dispatchRepository.update(ticketId, {
      towFare: {...towFare, waitingFee: fee},
    });
  }
  return {fee};
};

const accrue = async ({
  ticketId,
  towerLat,
  towerLng,
  riderLat,
  riderLng,
  now,
}: {
  ticketId: string;
  towerLat?: number;
  towerLng?: number;
  riderLat?: number;
  riderLng?: number;
  now?: Date;
}): Promise<{fee: number; active: boolean; withinRadius: boolean | null}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {fee: 0, active: false, withinRadius: null};
  const waiting = ticket.waiting as {
    active?: boolean;
    startedAt?: string | null;
    fee?: unknown;
    withinRadius?: unknown;
  } | null | undefined;
  const priorFee = typeof waiting?.fee === "number" ? waiting.fee : 0;
  if (!waiting || waiting.active !== true ||
    typeof waiting.startedAt !== "string") {
    return {fee: priorFee, active: false, withinRadius: null};
  }
  if (typeof towerLat !== "number" || typeof towerLng !== "number" ||
    typeof riderLat !== "number" || typeof riderLng !== "number") {
    return {
      fee: priorFee,
      active: true,
      withinRadius: typeof waiting.withinRadius === "boolean" ?
        waiting.withinRadius :
        null,
    };
  }
  const rules = await waitingRules();
  const nowMs = (now ?? new Date()).getTime();
  const elapsedMs = Math.min(
    Math.max(0, nowMs - Date.parse(waiting.startedAt)),
    rules.capMs,
  );
  const near = haversineMeters(towerLat, towerLng, riderLat, riderLng) <=
    rules.radiusM;
  const fee = near ? calcFee(elapsedMs, rules) : priorFee;
  await dispatchRepository.update(ticketId, {
    waiting: {
      ...waiting,
      fee,
      withinRadius: near,
      accruedAt: new Date(nowMs).toISOString(),
    },
  });
  const towFare = ticket.towFare as Record<string, unknown> | null | undefined;
  if (towFare && typeof towFare === "object") {
    await dispatchRepository.update(ticketId, {
      towFare: {...towFare, waitingFee: fee},
    });
  }
  return {fee, active: true, withinRadius: near};
};

const currentWaitingFee = async (
  ticket: {
    id: string;
    lat: number;
    lng: number;
    assignedShopId?: unknown;
    waiting?: unknown;
  },
): Promise<number | null> => {
  const waiting = ticket.waiting as {
    active?: boolean;
    startedAt?: string | null;
    fee?: unknown;
  } | null | undefined;
  if (!waiting) return null;
  const stored = typeof waiting.fee === "number" ? waiting.fee : null;
  if (waiting.active !== true) return stored;
  if (typeof waiting.startedAt !== "string") return stored;
  const rules = await waitingRules();
  const elapsedMs = Math.min(
    Math.max(0, Date.now() - Date.parse(waiting.startedAt)),
    rules.capMs,
  );
  const near = await towerWithinRange(
    ticket.assignedShopId,
    ticket.lat,
    ticket.lng,
    rules.radiusM,
  );
  if (!near) return stored ?? 0;
  return calcFee(elapsedMs, rules);
};

const assertWaitingReader = async (
  ticket: {
    userId: string;
    assignedUid?: unknown;
    assignedShopId?: unknown;
    providerId?: unknown;
  },
  userId: string,
): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  if (ticket.userId === userId) return;
  if (ticket.assignedUid === userId) return;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) return;
  }
  throw new ForbiddenError("Only ticket participants read waiting");
};

export const getWaitingSummary = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  await assertWaitingReader(ticket, userId);
  const rules = await waitingRules();
  const waiting = ticket.waiting as {
    active?: boolean;
    startedAt?: string | null;
    endedAt?: string | null;
    fee?: unknown;
  } | null | undefined;
  const active = waiting?.active === true;
  const startedAt = typeof waiting?.startedAt === "string" ?
    waiting.startedAt :
    null;
  const endedAt = typeof waiting?.endedAt === "string" ?
    waiting.endedAt :
    null;
  let elapsedMs = 0;
  if (active && startedAt) {
    elapsedMs = Math.min(
      Math.max(0, Date.now() - Date.parse(startedAt)),
      rules.capMs,
    );
  } else if (startedAt && endedAt) {
    elapsedMs = Math.min(
      Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      rules.capMs,
    );
  }
  const withinRadius = await towerWithinRange(
    ticket.assignedShopId,
    ticket.lat,
    ticket.lng,
    rules.radiusM,
  );
  const stored = typeof waiting?.fee === "number" ? waiting.fee : 0;
  const fee = active && withinRadius ? calcFee(elapsedMs, rules) : stored;
  return {
    active,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    fee,
    graceMinutes: rules.graceMs / MS_PER_MIN,
    capMinutes: rules.capMs / MS_PER_MIN,
    withinRadius,
  };
};

export {
  startWaiting,
  stopWaiting,
  accrue,
  currentWaitingFee,
  calcFee,
  WaitingRules,
};
