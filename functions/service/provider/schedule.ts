import {
  PROVIDER_PRICING_BOUNDS,
} from "../../constants/dispatch";
import {
  PROVIDER_SERVICE_CODE_MAX,
  PROVIDER_SERVICE_NAME_MAX,
  PROVIDER_SERVICE_PRICE_MAX,
  PROVIDER_SERVICES_MAX,
  SERVICE_CATEGORY,
  SERVICE_CHANNEL,
  VEHICLE_CLASS,
} from "../../constants/status";

import {isCarVehicle} from "../../utils/valhalla";

import {ValidationError} from "../../utils/errors";

const DOW_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const SHOP_TZ_OFFSET_MINUTES = 7 * 60;

const shopLocalParts = (now: Date): {day: string; minutes: number} => {
  const shifted = new Date(now.getTime() + SHOP_TZ_OFFSET_MINUTES * 60 * 1000);
  const dayIdx = shifted.getUTCDay();
  return {
    day: DOW_KEYS[dayIdx] ?? "",
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

const parseSchedule = (
  openHours: string,
): Array<{day: string; open: number; close: number}> => {
  const trimmed = openHours.trim();
  const normalized = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(trimmed) ?
    DOW_KEYS.map((d) => `${d} ${trimmed}`).join(",") :
    openHours;
  const out: Array<{day: string; open: number; close: number}> = [];
  for (const entry of normalized.split(",")) {
    const text = entry.trim();
    const bare = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(text);
    if (bare) {
      const open = Number(bare[1]) * 60 + Number(bare[2]);
      const close = Number(bare[3]) * 60 + Number(bare[4]);
      if (Number(bare[1]) > 23 || Number(bare[2]) > 59) continue;
      if (Number(bare[3]) > 23 || Number(bare[4]) > 59) continue;
      if (open === close) continue;
      for (const d of DOW_KEYS) out.push({day: d, open, close});
      continue;
    }
    const m = /^(MON|TUE|WED|THU|FRI|SAT|SUN) (\d{2}):(\d{2})-(\d{2}):(\d{2})$/
      .exec(text);
    if (!m) continue;
    const open = Number(m[2]) * 60 + Number(m[3]);
    const close = Number(m[4]) * 60 + Number(m[5]);
    if (Number(m[2]) > 23 || Number(m[3]) > 59) continue;
    if (Number(m[4]) > 23 || Number(m[5]) > 59) continue;
    if (open === close) continue;
    out.push({day: m[1], open, close});
  }
  return out;
};

export const parseScheduleRanges = (
  openHours: string | null | undefined,
): Array<{day: string; open: number; close: number}> =>
  openHours ? parseSchedule(openHours) : [];

export const isOpenNow = (
  openHours: string | null | undefined,
  now: Date = new Date(),
): boolean | null => {
  if (!openHours) return null;
  const entries = parseSchedule(openHours);
  if (entries.length === 0) return null;
  const {day: today, minutes: cur} = shopLocalParts(now);
  const todayIdx = DOW_KEYS.indexOf(today);
  const yesterday = DOW_KEYS[(todayIdx + 6) % 7] ?? "";
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

export const nextTransition = (
  openHours: string | null | undefined,
  now: Date = new Date(),
): number | null => {
  if (!openHours) return null;
  const entries = parseSchedule(openHours);
  if (entries.length === 0) return null;
  const {day: today, minutes: cur} = shopLocalParts(now);
  const todayIdx = DOW_KEYS.indexOf(today);
  const yesterday = DOW_KEYS[(todayIdx + 6) % 7] ?? "";
  let remaining: number | null = null;
  for (const e of entries) {
    if (e.day === today && e.open <= e.close) {
      if (cur >= e.open && cur < e.close) {
        const left = e.close - cur;
        remaining = remaining === null ? left : Math.min(remaining, left);
      }
    } else if (e.open > e.close) {
      if (e.day === today && cur >= e.open) {
        const left = 1440 - cur + e.close;
        remaining = remaining === null ? left : Math.min(remaining, left);
      } else if (e.day === yesterday && cur < e.close) {
        const left = e.close - cur;
        remaining = remaining === null ? left : Math.min(remaining, left);
      }
    }
  }
  return remaining;
};

export const vehicleClassOf = (
  vehicleType: string | null | undefined,
): string =>
  isCarVehicle(vehicleType ?? undefined) ?
    VEHICLE_CLASS.CAR :
    VEHICLE_CLASS.SOLO_BIKE;

export const servesVehicleClass = (
  provider: {vehicleClasses?: unknown},
  vehicleClass: string,
): boolean => {
  const classes = provider.vehicleClasses;
  if (!Array.isArray(classes) || classes.length === 0) return true;
  return (classes as unknown[]).includes(vehicleClass);
};

type ShopService = {
  code: string;
  name: string;
  displayPrice: number;
  quoteRequired: boolean;
  category: string;
  warrantyDays?: number;
  warrantyParts?: string;
  channels?: string[];
  vehicleClasses?: string[];
};

type ShopServiceOptions = {
  kind?: string;
  providerVehicleClasses?: string[];
};

export const normalizeTowPricing = ({
  towBaseFee,
  towPerKmFee,
  bounds = PROVIDER_PRICING_BOUNDS.TOW,
}: {
  towBaseFee?: number;
  towPerKmFee?: number;
  bounds?: {
    baseMin: number;
    baseMax: number;
    perKmMin: number;
    perKmMax: number;
  };
}): {towBaseFee?: number; towPerKmFee?: number} => {
  if (towBaseFee !== undefined &&
    (towBaseFee < bounds.baseMin || towBaseFee > bounds.baseMax)) {
    throw new ValidationError(
      `Tow base fee must be ${bounds.baseMin}-${bounds.baseMax}`,
    );
  }
  if (towPerKmFee !== undefined &&
    (towPerKmFee < bounds.perKmMin || towPerKmFee > bounds.perKmMax)) {
    throw new ValidationError(
      `Tow per-km fee must be ${bounds.perKmMin}-${bounds.perKmMax}`,
    );
  }
  return {
    ...(towBaseFee !== undefined ? {towBaseFee} : {}),
    ...(towPerKmFee !== undefined ? {towPerKmFee} : {}),
  };
};

export const normalizeMobileShopPricing = ({
  callOutFee,
  travelPerKmFee,
  bounds = PROVIDER_PRICING_BOUNDS.MOBILE_SHOP,
}: {
  callOutFee?: number;
  travelPerKmFee?: number;
  bounds?: {
    callOutMin: number;
    callOutMax: number;
    travelPerKmMin: number;
    travelPerKmMax: number;
  };
}): {callOutFee?: number; travelPerKmFee?: number} => {
  if (callOutFee !== undefined &&
    (callOutFee < bounds.callOutMin || callOutFee > bounds.callOutMax)) {
    throw new ValidationError(
      `Call-out fee must be ${bounds.callOutMin}-${bounds.callOutMax}`,
    );
  }
  if (travelPerKmFee !== undefined &&
    (travelPerKmFee < bounds.travelPerKmMin ||
      travelPerKmFee > bounds.travelPerKmMax)) {
    throw new ValidationError(
      `Travel per-km fee must be ${bounds.travelPerKmMin}-` +
      `${bounds.travelPerKmMax}`,
    );
  }
  return {
    ...(callOutFee !== undefined ? {callOutFee} : {}),
    ...(travelPerKmFee !== undefined ? {travelPerKmFee} : {}),
  };
};

const normalizeServiceVehicleClasses = (
  raw: unknown,
  fallback: string[],
): string[] => {
  const valid = Object.values(VEHICLE_CLASS) as string[];
  if (raw === undefined || raw === null) return fallback;
  const classes = Array.isArray(raw) ? raw : [];
  if (classes.length === 0 ||
    classes.some((value) => !valid.includes(String(value)))) {
    throw new ValidationError("Service vehicle classes are invalid");
  }
  return [...new Set(classes.map((value) => String(value)))];
};

const serviceVehicleClasses = (
  raw: unknown,
  options: ShopServiceOptions,
): string[] => {
  const providerClasses = options.providerVehicleClasses !== undefined &&
    options.providerVehicleClasses.length > 0 ?
    options.providerVehicleClasses : [...Object.values(VEHICLE_CLASS)];
  const classes = normalizeServiceVehicleClasses(raw, providerClasses);
  if (classes.some((value) => !providerClasses.includes(value))) {
    throw new ValidationError(
      "Service vehicle classes must match the provider",
    );
  }
  return classes;
};

const normalizeServiceChannels = (raw: unknown): string[] => {
  const valid = Object.values(SERVICE_CHANNEL) as string[];
  const channels = raw === undefined ? [...valid] :
    Array.isArray(raw) ? raw : [];
  if (channels.length === 0 ||
    channels.some((channel) => !valid.includes(channel))) {
    throw new ValidationError("Service channels are invalid");
  }
  return [...new Set(channels)];
};

const normalizeShopService = (
  raw: unknown,
  categories: string[],
  seen: Set<string>,
  options: ShopServiceOptions,
): ShopService => {
  const item = typeof raw === "object" && raw !== null ?
    raw as Record<string, unknown> :
    {};
  const code = typeof item.code === "string" ? item.code.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const displayPrice = item.displayPrice;
  const quoteRequired = item.quoteRequired;
  const rawCategory = typeof item.category === "string" ?
    item.category.trim() :
    "";
  const category = rawCategory === "" ? SERVICE_CATEGORY.OTHER : rawCategory;
  const warrantyDays = item.warrantyDays;
  const warrantyParts = item.warrantyParts;
  const vehicleClasses = serviceVehicleClasses(
    item.vehicleClasses,
    options,
  );
  const channels = options.kind === "MOBILE_SHOP" ?
    [SERVICE_CHANNEL.ASSIST] :
    normalizeServiceChannels(item.channels);
  if (code === "" || code.length > PROVIDER_SERVICE_CODE_MAX) {
    throw new ValidationError("Service code is invalid");
  }
  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new ValidationError(
      "Service code must be uppercase letters, digits or underscores",
    );
  }
  if (seen.has(code)) {
    throw new ValidationError("Service codes must be unique");
  }
  seen.add(code);
  if (name === "" || name.length > PROVIDER_SERVICE_NAME_MAX) {
    throw new ValidationError("Service name is invalid");
  }
  if (typeof displayPrice !== "number" ||
    !Number.isInteger(displayPrice) || displayPrice < 0 ||
    displayPrice > PROVIDER_SERVICE_PRICE_MAX) {
    throw new ValidationError("Service price is invalid");
  }
  if (typeof quoteRequired !== "boolean") {
    throw new ValidationError("Service quote flag is invalid");
  }
  if (!categories.includes(category)) {
    throw new ValidationError("Service category is invalid");
  }
  if (warrantyDays !== undefined &&
    (typeof warrantyDays !== "number" || !Number.isInteger(warrantyDays) ||
      warrantyDays < 0 || warrantyDays > 90)) {
    throw new ValidationError("Service warranty is invalid");
  }
  if (warrantyParts !== undefined &&
    warrantyParts !== "LABOR_ONLY" && warrantyParts !== "PARTS_AND_LABOR") {
    throw new ValidationError("Service warranty coverage is invalid");
  }
  return {
    code,
    name,
    displayPrice,
    quoteRequired,
    category,
    ...(warrantyDays !== undefined ? {warrantyDays} : {}),
    ...(warrantyParts !== undefined ? {warrantyParts} : {}),
    channels,
    vehicleClasses,
  };
};

export const normalizeShopServices = (
  services: unknown,
  options: ShopServiceOptions = {},
): ShopService[] => {
  if (!Array.isArray(services)) {
    throw new ValidationError("Services must be a list");
  }
  if (services.length > PROVIDER_SERVICES_MAX) {
    throw new ValidationError("Too many services");
  }
  const categories = Object.values(SERVICE_CATEGORY) as string[];
  const seen = new Set<string>();
  return services.map((raw) =>
    normalizeShopService(raw, categories, seen, options));
};
