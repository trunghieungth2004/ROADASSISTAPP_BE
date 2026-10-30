

import {
  PROVIDER_SERVICE_CODE_MAX,
  PROVIDER_SERVICE_NAME_MAX,
  PROVIDER_SERVICE_PRICE_MAX,
  PROVIDER_SERVICES_MAX,
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
};

export const normalizeShopServices = (services: unknown): ShopService[] => {
  if (!Array.isArray(services)) {
    throw new ValidationError("Services must be a list");
  }
  if (services.length > PROVIDER_SERVICES_MAX) {
    throw new ValidationError("Too many services");
  }
  const out: ShopService[] = [];
  for (const raw of services) {
    const item = typeof raw === "object" && raw !== null ?
      raw as Record<string, unknown> :
      {};
    const code = typeof item.code === "string" ? item.code.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const displayPrice = item.displayPrice;
    const quoteRequired = item.quoteRequired;
    if (code === "" || code.length > PROVIDER_SERVICE_CODE_MAX) {
      throw new ValidationError("Service code is invalid");
    }
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
    out.push({code, name, displayPrice, quoteRequired});
  }
  return out;
};
