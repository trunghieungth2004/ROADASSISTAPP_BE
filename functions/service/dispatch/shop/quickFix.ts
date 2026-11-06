import {randomUUID} from "crypto";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as paymentService from "../../paymentService";
import {chatService} from "../../chatService";
import {enqueueDispatchPush} from "../../taskQueueService";
import {NS} from "../constants";
import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";
import {QUICK_FIX_MAX_AMOUNT} from "../../../constants/dispatch";
import * as platformConfigService from "../../platformConfigService";

type QuickFixItem = {
  name: string;
  qty: number;
  unitPrice: number;
};

const normalizeItems = (items: unknown): QuickFixItem[] => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("Add at least one service");
  }
  if (items.length > 10) throw new ValidationError("Too many services");
  const out: QuickFixItem[] = [];
  for (const raw of items) {
    const row = typeof raw === "object" && raw !== null ?
      raw as Record<string, unknown> :
      {};
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const qty = row.qty;
    const unitPrice = row.unitPrice;
    if (name === "") throw new ValidationError("Service name is required");
    if (typeof qty !== "number" || !Number.isInteger(qty) ||
      qty < 1 || qty > 10) {
      throw new ValidationError("Service quantity is invalid");
    }
    if (typeof unitPrice !== "number" || !Number.isInteger(unitPrice) ||
      unitPrice < 0) {
      throw new ValidationError("Service price is invalid");
    }
    out.push({name, qty, unitPrice});
  }
  return out;
};

const matchCatalog = (
  items: QuickFixItem[],
  services: unknown,
  vehicleClass?: string,
): void => {
  const catalog = Array.isArray(services) ? services : [];
  for (const item of items) {
    const match = catalog.find((service) => {
      if (typeof service !== "object" || service === null) return false;
      const row = service as Record<string, unknown>;
      return typeof row.name === "string" &&
        row.name.trim().toLowerCase() === item.name.toLowerCase();
    }) as unknown as Record<string, unknown> | undefined;
    if (!match) {
      throw new ValidationError(`Unknown service: ${item.name}`);
    }
    if (match.quoteRequired === true) {
      throw new ValidationError(
        `${item.name} requires an inspection quote`,
      );
    }
    if (match.displayPrice !== item.unitPrice) {
      throw new ValidationError(`${item.name} price does not match catalog`);
    }
    if (vehicleClass !== undefined &&
      Array.isArray(match.vehicleClasses) &&
      match.vehicleClasses.length > 0 &&
      !match.vehicleClasses.includes(vehicleClass)) {
      throw new ValidationError(
        `${item.name} is not available for this vehicle class`,
      );
    }
  }
};

export const quickFix = async ({
  userId,
  ticketId,
  items,
}: {
  userId: string;
  ticketId: string;
  items: unknown;
}) => {
  const config = await platformConfigService.getConfig()
    .catch(() => null);
  if (config?.features?.quickFix === false) {
    throw new ValidationError("Quick fix is disabled");
  }
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "WALK_IN" &&
    ticket.ticketType !== "MECHANIC") {
    throw new ValidationError("Quick fix is for shop tickets");
  }
  if (ticket.status !== STATUS_DISPATCH.MATCHED) {
    throw new ValidationError("Quick fix needs an accepted ticket");
  }
  if (ticket.depositStatus === "REQUESTED") {
    throw new ValidationError("Settle or waive the deposit first");
  }
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  const shop = shopId === "" ? null :
    await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Shop not found");
  if (caller.role !== ROLE_ADMIN && shop.operatorUid !== userId) {
    throw new ForbiddenError("Only the assigned shop starts a quick fix");
  }
  if (shop.kind !== PROVIDER_KIND.SHOP) {
    throw new ValidationError("Quick fix is for repair shops");
  }
  const normalized = normalizeItems(items);
  matchCatalog(
    normalized,
    shop.services,
    typeof ticket.vehicleClass === "string" ? ticket.vehicleClass : undefined,
  );
  const catalog = Array.isArray(shop.services) ? shop.services : [];
  const quoteItems = normalized.map((item) => {
    const service = catalog.find((row) => {
      if (typeof row !== "object" || row === null) return false;
      const record = row as unknown as Record<string, unknown>;
      return typeof record.name === "string" &&
        record.name.trim().toLowerCase() === item.name.toLowerCase();
    }) as unknown as Record<string, unknown> | undefined;
    return {
      lineId: randomUUID(),
      kind: "SERVICE",
      serviceCode: String(service?.code ?? ""),
      ...(typeof service?.category === "string" ?
        {category: service.category} :
        {}),
      name: String(service?.name ?? item.name),
      qty: item.qty,
      unitPrice: item.unitPrice,
      amount: item.qty * item.unitPrice,
      priceMode: "FIXED",
      listPrice: item.unitPrice,
      ...(typeof service?.warrantyDays === "number" ?
        {warrantyDays: service.warrantyDays} :
        {}),
      ...(typeof service?.warrantyParts === "string" ?
        {warrantyParts: service.warrantyParts} :
        {}),
    };
  });
  const amount = quoteItems.reduce((sum, item) => sum + item.amount, 0);
  if (amount <= 0) throw new ValidationError("Quick fix total is invalid");
  if (amount > QUICK_FIX_MAX_AMOUNT) {
    throw new ValidationError("Quick fix total is above the direct limit");
  }
  const version = typeof ticket.quoteVersion === "number" ?
    ticket.quoteVersion :
    0;
  await dispatchRepository.update(ticketId, {
    shopQuotedAmount: amount,
    quoteItems,
    quoteVersion: version + 1,
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
    quoteApprovedAt: new Date().toISOString(),
    paymentArmed: true,
    quickFix: true,
    preQuoteStatus: ticket.status,
  });
  await paymentService.createPaymentForTicket({
    userId: ticket.userId,
    ticketId,
    method: "CASH",
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.IN_PROGRESS,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    `Quick fix started: ${amount} VND.`,
    "QUICK_FIX_STARTED",
    {amount},
  );
  await enqueueDispatchPush(ticketId, "-quick-fix", {
    audience: "rider",
    title: "Work started",
    body: `Your shop started a ${amount.toLocaleString()} VND quick fix.`,
  }).catch(() => undefined);
  return {quickFix: true, amount};
};
