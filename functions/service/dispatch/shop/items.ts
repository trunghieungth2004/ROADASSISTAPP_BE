import {
  WORK_ITEM_LIMIT,
  WORK_ITEM_NAME_MAX,
  WORK_ITEM_PRICE_MAX,
  WORK_ITEM_QTY_MAX,
} from "../../../constants/dispatch";
import {ValidationError} from "../../../utils/errors";

export type WorkItem = {
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export const normalizeWorkItems = (input: unknown): WorkItem[] => {
  if (!Array.isArray(input)) {
    throw new ValidationError("Work items must be a list");
  }
  if (input.length > WORK_ITEM_LIMIT) {
    throw new ValidationError("Too many work items");
  }
  const out: WorkItem[] = [];
  for (const raw of input) {
    const item = typeof raw === "object" && raw !== null ?
      raw as Record<string, unknown> :
      {};
    const name = typeof item.name === "string" ? item.name.trim() : "";
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
    out.push({
      name,
      qty,
      unitPrice,
      amount: qty * unitPrice,
    });
  }
  return out;
};

export const workItemsTotal = (items: WorkItem[]): number =>
  items.reduce((sum, item) => sum + item.amount, 0);

export const resolveQuoteAmount = ({
  quotedAmount,
  items,
}: {
  quotedAmount?: number;
  items?: unknown;
}): {amount: number; workItems: WorkItem[] | null} => {
  const workItems = items === undefined ? null : normalizeWorkItems(items);
  const itemTotal = workItems === null ? null : workItemsTotal(workItems);
  if (itemTotal !== null && quotedAmount !== undefined &&
    quotedAmount !== itemTotal) {
    throw new ValidationError("Quote total must match the item list");
  }
  const amount = itemTotal ?? quotedAmount;
  if (amount === undefined) {
    throw new ValidationError("Quote needs an amount");
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new ValidationError("Quote must be a non-negative integer");
  }
  return {amount, workItems};
};
