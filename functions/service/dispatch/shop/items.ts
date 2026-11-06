import {randomUUID} from "crypto";
import {
  WORK_ITEM_LIMIT,
  WORK_ITEM_NAME_MAX,
  WORK_ITEM_PRICE_MAX,
  WORK_ITEM_QTY_MAX,
} from "../../../constants/dispatch";
import {ValidationError} from "../../../utils/errors";

const EXTRA_LIMIT = 5;
const NOTE_MIN = 3;
const NOTE_MAX = 280;
const FEE_TYPES: string[] = ["TOLL", "PARKING", "LABOR", "ACCESS", "OTHER"];

type CatalogService = {
  code: string;
  name: string;
  displayPrice: number;
  quoteRequired: boolean;
  category?: string;
  warrantyDays?: number;
  warrantyParts?: string;
  vehicleClasses?: string[];
};

export type WorkItem = {
  lineId: string;
  kind: "SERVICE" | "EXTRA";
  serviceCode?: string;
  category?: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  priceMode: "FIXED" | "QUOTED" | "CUSTOM";
  listPrice?: number;
  warrantyDays?: number;
  warrantyParts?: string;
  warrantyUntil?: string | null;
  note?: string;
  feeType?: string;
  legacy?: boolean;
};

type NormalizeOptions = {
  services?: CatalogService[] | null;
  allowExtras?: boolean;
  maxExtras?: number;
  catalogOnly?: boolean;
  free?: boolean;
  vehicleClass?: string;
};

type Base = {name: string; qty: number; unitPrice: number};

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const readBase = (item: Record<string, unknown>): Base => {
  const name = str(item.name);
  const qty = item.qty;
  const unitPrice = item.unitPrice;
  if (name === "" || name.length > WORK_ITEM_NAME_MAX) {
    throw new ValidationError("Work item name is invalid");
  }
  if (typeof qty !== "number" || !Number.isInteger(qty) ||
    qty < 1 || qty > WORK_ITEM_QTY_MAX) {
    throw new ValidationError("Work item quantity is invalid");
  }
  if (typeof unitPrice !== "number" || !Number.isInteger(unitPrice) ||
    unitPrice < 0 || unitPrice > WORK_ITEM_PRICE_MAX) {
    throw new ValidationError("Work item price is invalid");
  }
  return {name, qty, unitPrice};
};

const resolveService = (
  services: CatalogService[] | null | undefined,
  code: string,
): CatalogService => {
  if (!Array.isArray(services) || services.length === 0) {
    throw new ValidationError("Service catalog is unavailable");
  }
  const match = services.find((service) =>
    String(service.code).toUpperCase() === code.toUpperCase());
  if (!match) throw new ValidationError(`Unknown service: ${code}`);
  return match;
};

const buildService = (
  item: Record<string, unknown>,
  base: Base,
  services: CatalogService[] | null | undefined,
  fixedCodes: Set<string>,
  free: boolean,
  vehicleClass?: string,
): WorkItem => {
  const code = str(item.serviceCode);
  if (code === "") throw new ValidationError("Service code is required");
  const service = resolveService(services, code);
  if (vehicleClass !== undefined &&
    Array.isArray(service.vehicleClasses) &&
    service.vehicleClasses.length > 0 &&
    !service.vehicleClasses.includes(vehicleClass)) {
    throw new ValidationError(
      `${service.name} is not available for this vehicle class`,
    );
  }
  const fixed = service.quoteRequired !== true;
  if (fixed) {
    if (!free && base.unitPrice !== service.displayPrice) {
      throw new ValidationError(`${service.name} must use the catalog price`);
    }
    if (fixedCodes.has(service.code)) {
      throw new ValidationError("Duplicate fixed service");
    }
    fixedCodes.add(service.code);
  }
  const note = str(item.note);
  const warrantyDays = typeof service.warrantyDays === "number" ?
    service.warrantyDays :
    undefined;
  return {
    lineId: randomUUID(),
    kind: "SERVICE",
    serviceCode: service.code,
    category: service.category,
    name: service.name,
    qty: base.qty,
    unitPrice: base.unitPrice,
    amount: base.qty * base.unitPrice,
    priceMode: fixed ? "FIXED" : "QUOTED",
    listPrice: service.displayPrice,
    ...(warrantyDays !== undefined ? {warrantyDays} : {}),
    ...(service.warrantyParts !== undefined ?
      {warrantyParts: service.warrantyParts} :
      {}),
    ...(note !== "" ? {note} : {}),
  };
};

const buildExtra = (
  item: Record<string, unknown>,
  base: Base,
  legacy: boolean,
): WorkItem => {
  const note = str(item.note);
  if (!legacy && (note.length < NOTE_MIN || note.length > NOTE_MAX)) {
    throw new ValidationError("Extra charges need a reason");
  }
  const feeType = str(item.feeType);
  if (feeType !== "" && !FEE_TYPES.includes(feeType)) {
    throw new ValidationError("Unknown extra fee type");
  }
  return {
    lineId: randomUUID(),
    kind: "EXTRA",
    name: base.name,
    qty: base.qty,
    unitPrice: base.unitPrice,
    amount: base.qty * base.unitPrice,
    priceMode: "CUSTOM",
    ...(note !== "" ? {note} : {}),
    ...(feeType !== "" ? {feeType} : {}),
    ...(legacy ? {legacy: true} : {}),
  };
};

export const normalizeWorkItems = (
  input: unknown,
  options: NormalizeOptions = {},
): WorkItem[] => {
  if (!Array.isArray(input)) {
    throw new ValidationError("Work items must be a list");
  }
  if (input.length > WORK_ITEM_LIMIT) {
    throw new ValidationError("Too many work items");
  }
  const allowExtras = options.allowExtras !== false &&
    options.catalogOnly !== true;
  const maxExtras = options.maxExtras ?? EXTRA_LIMIT;
  let extras = 0;
  const fixedCodes = new Set<string>();
  const out: WorkItem[] = [];
  for (const raw of input) {
    const item = typeof raw === "object" && raw !== null ?
      raw as Record<string, unknown> :
      {};
    const base = readBase(item);
    const code = str(item.serviceCode);
    const requestedKind = str(item.kind);
    const legacy = requestedKind === "" && code === "";
    const isService = !legacy &&
      (requestedKind === "SERVICE" || code !== "");
    if (isService) {
      out.push(buildService(
        item,
        base,
        options.services,
        fixedCodes,
        options.free === true,
        options.vehicleClass,
      ));
      continue;
    }
    if (!allowExtras) {
      throw new ValidationError("Extras are not allowed in this quote");
    }
    extras += 1;
    if (extras > maxExtras) {
      throw new ValidationError("Too many extra charges");
    }
    out.push(buildExtra(item, base, legacy));
  }
  return out;
};

export const workItemsTotal = (items: WorkItem[]): number =>
  items.reduce((sum, item) => sum + item.amount, 0);

export const freePricedItems = (
  items: WorkItem[] | null,
): WorkItem[] | null => items === null ?
  null :
  items.map((item) => ({...item, unitPrice: 0, amount: 0}));

export const resolveQuoteAmount = ({
  quotedAmount,
  items,
  services,
  free = false,
  vehicleClass,
}: {
  quotedAmount?: number;
  items?: unknown;
  services?: CatalogService[] | null;
  free?: boolean;
  vehicleClass?: string;
}): {amount: number; workItems: WorkItem[] | null} => {
  const workItems = items === undefined ?
    null :
    normalizeWorkItems(
      items,
      {services, allowExtras: true, free, vehicleClass},
    );
  const itemTotal = workItems === null ? null : workItemsTotal(workItems);
  if (!free && itemTotal !== null && quotedAmount !== undefined &&
    quotedAmount !== itemTotal) {
    throw new ValidationError("Quote total must match the item list");
  }
  const amount = free ? 0 : itemTotal ?? quotedAmount;
  if (amount === undefined) {
    throw new ValidationError("Quote needs an amount");
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new ValidationError("Quote must be a non-negative integer");
  }
  return {amount, workItems: free ? freePricedItems(workItems) : workItems};
};
