import * as platformConfigRepository from
  "../repository/platformConfigRepository";
import * as cacheManager from "../utils/cacheManager";
import {
  COMMISSION_RATE_FALLBACK,
  PLATFORM_CONFIG_CACHE_NAMESPACE,
  PLATFORM_CONFIG_ID,
  PLATFORM_CONFIG_UPDATABLE_KEYS,
  REFUND_POLICY,
  WAITING_PER_MIN,
  WAITING_RADIUS_M,
} from "../constants/payments";
import {ValidationError} from "../utils/errors";
import {logWarn} from "../utils/logger";

interface TowRates {
  towBaseFee: number;
  towPerKmFee: number;
  carMultiplier: number;
  nightMultiplier: number;
  nightWindow: {start: number; end: number};
  minimumTowFee: number;
  deadheadPayable: boolean;
}

interface WaitingRates {
  ratePer15Min: number;
  graceMin: number;
  capMin: number;
  blockMin: number;
  radiusM: number;
  detourTolerancePct: number;
}

const configCached = cacheManager.wrap(
  async (): Promise<platformConfigRepository.PlatformConfig> =>
    platformConfigRepository.get(),
  {
    namespace: PLATFORM_CONFIG_CACHE_NAMESPACE,
    keyFn: () => PLATFORM_CONFIG_ID,
  },
);

const validatePaymentConfig = (
  config: platformConfigRepository.PlatformConfig,
): string[] => {
  const issues: string[] = [];
  for (const [kind, rate] of Object.entries(config.commissionRate)) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      issues.push(`commissionRate.${kind}`);
    }
  }
  if (config.paymentMethodsEnabled.length === 0) {
    issues.push("paymentMethodsEnabled");
  }
  const policies: string[] = Object.values(REFUND_POLICY);
  if (!policies.includes(config.refundPolicy)) issues.push("refundPolicy");
  if (!Number.isFinite(config.waitingRatePer15Min) ||
    config.waitingRatePer15Min < 0) {
    issues.push("waitingRatePer15Min");
  }
  if (!(config.waitingGraceMin >= 0)) issues.push("waitingGraceMin");
  if (!(config.waitingCapMin >= config.waitingGraceMin)) {
    issues.push("waitingCapMin");
  }
  for (const key of ["towBaseFee", "towPerKmFee", "minimumTowFee"] as const) {
    if (!Number.isFinite(config[key]) || config[key] < 0) issues.push(key);
  }
  for (const key of ["carMultiplier", "nightMultiplier"] as const) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) issues.push(key);
  }
  const start = config.nightWindow.start;
  const end = config.nightWindow.end;
  if (!Number.isInteger(start) || start < 0 || start > 23) {
    issues.push("nightWindow.start");
  }
  if (!Number.isInteger(end) || end < 0 || end > 23 || end === start) {
    issues.push("nightWindow.end");
  }
  return issues;
};

let paymentConfigChecked = false;

const getConfig = async ():
  Promise<platformConfigRepository.PlatformConfig> => {
  const config = await configCached();
  if (!paymentConfigChecked) {
    paymentConfigChecked = true;
    const issues = validatePaymentConfig(config);
    if (issues.length > 0) {
      logWarn("payments", "Invalid payment config keys", {issues});
    }
  }
  return config;
};

const updateConfig = async (
  fields: Record<string, unknown>,
  adminUid: string,
): Promise<platformConfigRepository.PlatformConfig> => {
  const clean: Record<string, unknown> = {};
  for (const key of PLATFORM_CONFIG_UPDATABLE_KEYS) {
    if (fields[key] !== undefined) clean[key] = fields[key];
  }
  if (Object.keys(clean).length === 0) {
    throw new ValidationError("Nothing to update");
  }
  clean.updatedBy = adminUid;
  const updated = await platformConfigRepository.update(clean);
  configCached.invalidate(PLATFORM_CONFIG_ID);
  return updated;
};

const getCommissionRate = async (ticketType: string): Promise<number> => {
  const config = await getConfig();
  const rates = config.commissionRate as unknown as Record<string, number>;
  const rate = rates[ticketType];
  return typeof rate === "number" && Number.isFinite(rate) ?
    rate :
    COMMISSION_RATE_FALLBACK;
};

const getTowRates = async (): Promise<TowRates> => {
  const config = await getConfig();
  return {
    towBaseFee: config.towBaseFee,
    towPerKmFee: config.towPerKmFee,
    carMultiplier: config.carMultiplier,
    nightMultiplier: config.nightMultiplier,
    nightWindow: {
      start: config.nightWindow.start,
      end: config.nightWindow.end,
    },
    minimumTowFee: config.minimumTowFee,
    deadheadPayable: config.deadheadPayable,
  };
};

const getWaitingRates = async (): Promise<WaitingRates> => {
  const config = await getConfig();
  return {
    ratePer15Min: config.waitingRatePer15Min,
    graceMin: config.waitingGraceMin,
    capMin: config.waitingCapMin,
    blockMin: WAITING_PER_MIN,
    radiusM: WAITING_RADIUS_M,
    detourTolerancePct: config.detourTolerancePct,
  };
};

export {
  TowRates,
  WaitingRates,
  getConfig,
  updateConfig,
  getCommissionRate,
  getTowRates,
  getWaitingRates,
  validatePaymentConfig,
};
