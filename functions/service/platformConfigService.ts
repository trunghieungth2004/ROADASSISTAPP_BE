import * as platformConfigRepository from
  "../repository/platformConfigRepository";
import * as cacheManager from "../utils/cacheManager";
import {
  COMMISSION_RATE_FALLBACK,
  PLATFORM_CONFIG_CACHE_NAMESPACE,
  PLATFORM_CONFIG_ID,
  PLATFORM_CONFIG_UPDATABLE_KEYS,
  WAITING_PER_MIN,
  WAITING_RADIUS_M,
} from "../constants/payments";
import {ValidationError} from "../utils/errors";

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

const getConfig = async (): Promise<platformConfigRepository.PlatformConfig> =>
  configCached();

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
};
