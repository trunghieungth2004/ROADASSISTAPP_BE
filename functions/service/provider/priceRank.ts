export const SHOP_FREE_WALK_KM = 1;

export type ShopPricingMode = "FIXED" | "QUOTE" | "SERVICE_FEE";

export type ShopPriceEstimate = {
  estimatedServicePrice: number | null;
  estimatedTravelFee: number | null;
  estimatedTotal: number | null;
  pricingMode: ShopPricingMode;
  matchedServiceCode: string | null;
  matchedServiceName: string | null;
  estimatedDistanceKm: number | null;
};

type ServiceLike = {
  code?: unknown;
  name?: unknown;
  displayPrice?: unknown;
  quoteRequired?: unknown;
  category?: unknown;
  vehicleClasses?: unknown;
};

type ProviderLike = {
  services?: unknown;
  serviceFee?: unknown;
};

type ServiceMatch = {
  price: number | null;
  mode: ShopPricingMode;
  code: string | null;
  name: string | null;
};

const asServices = (value: unknown): ServiceLike[] =>
  Array.isArray(value) ? value as ServiceLike[] : [];

const serviceVehicleMatches = (
  service: ServiceLike,
  vehicleClass?: string,
): boolean => {
  if (vehicleClass === undefined) return true;
  const classes = service.vehicleClasses;
  if (!Array.isArray(classes) || classes.length === 0) return true;
  return classes.includes(vehicleClass);
};

const roundToThousand = (amount: number): number =>
  Math.round(amount / 1000) * 1000;

const codeOf = (service: ServiceLike | undefined): string | null =>
  service !== undefined && typeof service.code === "string" ?
    service.code :
    null;

const nameOf = (service: ServiceLike | undefined): string | null =>
  service !== undefined && typeof service.name === "string" ?
    service.name :
    null;

export const matchShopService = (
  provider: ProviderLike,
  {
    serviceCategory,
    vehicleClass,
  }: {
    serviceCategory?: string;
    vehicleClass?: string;
  } = {},
): ServiceMatch => {
  const candidates = asServices(provider.services).filter((service) =>
    (serviceCategory === undefined ||
      service.category === serviceCategory) &&
    serviceVehicleMatches(service, vehicleClass));
  const fixed = candidates
    .filter((service) =>
      service.quoteRequired === false &&
      typeof service.displayPrice === "number" &&
      Number.isFinite(service.displayPrice))
    .sort((a, b) =>
      (a.displayPrice as number) - (b.displayPrice as number));
  const fixedMatch = fixed[0];
  if (fixedMatch !== undefined) {
    return {
      price: fixedMatch.displayPrice as number,
      mode: "FIXED",
      code: codeOf(fixedMatch),
      name: nameOf(fixedMatch),
    };
  }
  const quoteMatch = candidates[0];
  if (quoteMatch === undefined && serviceCategory !== undefined) {
    return {price: null, mode: "QUOTE", code: null, name: null};
  }
  const fee = typeof provider.serviceFee === "number" &&
    Number.isFinite(provider.serviceFee) ?
    provider.serviceFee :
    null;
  return {
    price: fee,
    mode: fee !== null ? "SERVICE_FEE" : "QUOTE",
    code: codeOf(quoteMatch),
    name: nameOf(quoteMatch),
  };
};

export const estimateShopPrice = ({
  provider,
  distanceMeters,
  vehicleClass,
  serviceCategory,
  perKm,
  freeWalkKm = SHOP_FREE_WALK_KM,
}: {
  provider: ProviderLike;
  distanceMeters: number;
  vehicleClass?: string;
  serviceCategory?: string;
  perKm: number;
  freeWalkKm?: number;
}): ShopPriceEstimate => {
  const match = matchShopService(provider, {serviceCategory, vehicleClass});
  const distanceKm = Math.max(0, distanceMeters) / 1000;
  const billableKm = Math.max(0, distanceKm - freeWalkKm);
  const travelFee = roundToThousand(billableKm * perKm);
  return {
    estimatedServicePrice: match.price,
    estimatedTravelFee: travelFee,
    estimatedTotal: match.price === null ? null : match.price + travelFee,
    pricingMode: match.mode,
    matchedServiceCode: match.code,
    matchedServiceName: match.name,
    estimatedDistanceKm: distanceKm,
  };
};

export const compareShopPrice = (
  a: Partial<ShopPriceEstimate> & {
    distance?: unknown;
    openNow?: unknown;
    ratingAvg?: unknown;
  },
  b: Partial<ShopPriceEstimate> & {
    distance?: unknown;
    openNow?: unknown;
    ratingAvg?: unknown;
  },
): number => {
  const at = typeof a.estimatedTotal === "number" ?
    a.estimatedTotal :
    Number.MAX_SAFE_INTEGER;
  const bt = typeof b.estimatedTotal === "number" ?
    b.estimatedTotal :
    Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  const openRank = (value: unknown): number => {
    if (value === true) return 0;
    if (value === null || value === undefined) return 1;
    return 2;
  };
  const byOpen = openRank(a.openNow) - openRank(b.openNow);
  if (byOpen !== 0) return byOpen;
  const ad = typeof a.distance === "number" ?
    a.distance :
    Number.MAX_SAFE_INTEGER;
  const bd = typeof b.distance === "number" ?
    b.distance :
    Number.MAX_SAFE_INTEGER;
  if (ad !== bd) return ad - bd;
  const ar = typeof a.ratingAvg === "number" ? a.ratingAvg : 0;
  const br = typeof b.ratingAvg === "number" ? b.ratingAvg : 0;
  return br - ar;
};
