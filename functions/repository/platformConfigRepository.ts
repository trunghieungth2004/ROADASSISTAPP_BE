import {db} from "../config/firebase";
import {
  PAYMENT_METHOD,
  PLATFORM_CONFIG_COLLECTION,
  PLATFORM_CONFIG_DEFAULTS,
  PLATFORM_CONFIG_ID,
  WAITING_PER_MIN,
} from "../constants/payments";

interface CommissionRate {
  MECHANIC: number;
  TOW: number;
  SOS: number;
  WALK_IN: number;
}

interface NightWindow {
  start: number;
  end: number;
}

interface PlatformConfig {
  commissionRate: CommissionRate;
  towBaseFee: number;
  towPerKmFee: number;
  carMultiplier: number;
  nightMultiplier: number;
  nightWindow: NightWindow;
  minimumTowFee: number;
  waitingRatePer15Min: number;
  waitingGraceMin: number;
  waitingCapMin: number;
  waitingGraceMinutes: number;
  waitingCapMinutes: number;
  waitingBlockMinutes: number;
  detourTolerancePct: number;
  deadheadPayable: boolean;
  paymentMethodsEnabled: string[];
  refundPolicy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  [key: string]: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ?
    value as Record<string, unknown> :
    {};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asText = (value: unknown, fallback: string): string =>
  typeof value === "string" && value !== "" ? value : fallback;

const asMethods = (value: unknown): string[] => {
  const allowed = Object.values(PAYMENT_METHOD);
  const fallback = [...PLATFORM_CONFIG_DEFAULTS.paymentMethodsEnabled];
  if (!Array.isArray(value)) return fallback;
  const methods = value.filter(
    (entry): entry is string =>
      typeof entry === "string" &&
      (allowed as string[]).includes(entry),
  );
  return methods.length > 0 ? methods : fallback;
};

const get = async (): Promise<PlatformConfig> => {
  const doc = await db
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(PLATFORM_CONFIG_ID)
    .get();
  const raw = doc.exists ? asRecord(doc.data()) : {};
  const commission = asRecord(raw.commissionRate);
  const nightWindow = asRecord(raw.nightWindow);
  const defaults = PLATFORM_CONFIG_DEFAULTS;
  const waitingGraceMin = asNumber(
    raw.waitingGraceMin,
    defaults.waitingGraceMin,
  );
  const waitingCapMin = asNumber(raw.waitingCapMin, defaults.waitingCapMin);
  const merged: PlatformConfig = {
    commissionRate: {
      MECHANIC: asNumber(
        commission.MECHANIC,
        defaults.commissionRate.MECHANIC,
      ),
      TOW: asNumber(commission.TOW, defaults.commissionRate.TOW),
      SOS: asNumber(commission.SOS, defaults.commissionRate.SOS),
      WALK_IN: asNumber(
        commission.WALK_IN,
        defaults.commissionRate.WALK_IN,
      ),
    },
    towBaseFee: asNumber(raw.towBaseFee, defaults.towBaseFee),
    towPerKmFee: asNumber(raw.towPerKmFee, defaults.towPerKmFee),
    carMultiplier: asNumber(raw.carMultiplier, defaults.carMultiplier),
    nightMultiplier: asNumber(raw.nightMultiplier, defaults.nightMultiplier),
    nightWindow: {
      start: asNumber(nightWindow.start, defaults.nightWindow.start),
      end: asNumber(nightWindow.end, defaults.nightWindow.end),
    },
    minimumTowFee: asNumber(raw.minimumTowFee, defaults.minimumTowFee),
    waitingRatePer15Min: asNumber(
      raw.waitingRatePer15Min,
      defaults.waitingRatePer15Min,
    ),
    waitingGraceMin: waitingGraceMin,
    waitingCapMin: waitingCapMin,
    waitingGraceMinutes: asNumber(
      raw.waitingGraceMinutes,
      waitingGraceMin,
    ),
    waitingCapMinutes: asNumber(raw.waitingCapMinutes, waitingCapMin),
    waitingBlockMinutes: asNumber(
      raw.waitingBlockMinutes,
      WAITING_PER_MIN,
    ),
    detourTolerancePct: asNumber(
      raw.detourTolerancePct,
      defaults.detourTolerancePct,
    ),
    deadheadPayable: asBoolean(
      raw.deadheadPayable,
      defaults.deadheadPayable,
    ),
    paymentMethodsEnabled: asMethods(raw.paymentMethodsEnabled),
    refundPolicy: asText(raw.refundPolicy, defaults.refundPolicy),
  };
  if (typeof raw.updatedAt === "string") merged.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === "string") merged.updatedBy = raw.updatedBy;
  return merged;
};

const update = async (
  fields: Record<string, unknown>,
): Promise<PlatformConfig> => {
  await db
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(PLATFORM_CONFIG_ID)
    .set({
      ...fields,
      updatedAt: new Date().toISOString(),
    }, {merge: true});
  return get();
};

export {CommissionRate, NightWindow, PlatformConfig, get, update};
