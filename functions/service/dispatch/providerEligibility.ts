import {PROVIDER_STATUS} from "../../constants/status";

const restrictedUntilMs = (value: unknown): number => {
  if (typeof value !== "string") return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const providerBlocked = (provider: {
  status?: unknown;
  suspended?: unknown;
  restrictedUntil?: unknown;
} | null | undefined): boolean => {
  if (!provider) return true;
  if (provider.status !== undefined &&
    provider.status !== PROVIDER_STATUS.ACTIVE) return true;
  if (provider.suspended === true) return true;
  const until = restrictedUntilMs(provider.restrictedUntil);
  return Number.isFinite(until) && until > Date.now();
};

export {providerBlocked, restrictedUntilMs};
