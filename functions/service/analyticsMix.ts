import {BOOKING_OPEN_STATUSES, BOOKING_STATUS} from "../constants/booking";
import {STATUS_DISPATCH} from "../constants/status";

type Row = Record<string, unknown>;

type ServiceUsage = {
  key: string;
  name: string;
  category: string | null;
  count: number;
  revenue: number;
};

type TopService = {
  key: string;
  name: string;
  count: number;
  kind: "TYPE" | "SERVICE";
};

type ServiceMix = {
  total: number;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  services: ServiceUsage[];
  topService: TopService | null;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const itemRows = (ticket: Row): Row[] => {
  const invoice = Array.isArray(ticket.invoiceItems) ?
    ticket.invoiceItems as Row[] :
    [];
  if (invoice.length > 0) return invoice;
  return Array.isArray(ticket.quoteItems) ?
    ticket.quoteItems as Row[] :
    [];
};

const collectServiceMix = ({
  tickets,
  bookings,
}: {
  tickets: Row[];
  bookings: Row[];
}): ServiceMix => {
  const byType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const usage = new Map<string, ServiceUsage>();
  const addService = (input: {
    code?: unknown;
    name?: unknown;
    category?: unknown;
    count?: number;
    revenue?: number;
  }) => {
    const name = str(input.name).trim();
    const code = str(input.code).trim();
    const key = (code || name).toLowerCase();
    if (key === "") return;
    const row = usage.get(key) ?? {
      key,
      name: name || code,
      category: str(input.category) || null,
      count: 0,
      revenue: 0,
    };
    row.count += Math.max(1, input.count ?? 1);
    row.revenue += num(input.revenue);
    if (row.category === null && str(input.category) !== "") {
      row.category = str(input.category);
    }
    if (str(input.name) !== "") row.name = str(input.name);
    usage.set(key, row);
  };
  for (const ticket of tickets) {
    const type = str(ticket.ticketType) || "UNKNOWN";
    bump(byType, type);
    const symptom = str(ticket.symptom);
    if (symptom !== "") bump(byCategory, symptom);
    const items = itemRows(ticket);
    for (const item of items) {
      const category = str(item.category);
      if (category !== "") bump(byCategory, category);
      addService({
        code: item.serviceCode,
        name: item.name,
        category,
        count: typeof item.qty === "number" ? item.qty : 1,
        revenue: num(item.amount),
      });
    }
  }
  for (const booking of bookings) {
    const snapshot = Array.isArray(booking.serviceSnapshot) ?
      booking.serviceSnapshot as Row[] :
      [];
    if (snapshot.length > 0) {
      for (const item of snapshot) {
        addService({
          code: item.code,
          name: item.name,
          count: 1,
          revenue: num(item.price),
        });
      }
      continue;
    }
    const codes = Array.isArray(booking.serviceCodes) ?
      booking.serviceCodes as unknown[] :
      [];
    for (const code of codes) {
      const value = str(code);
      if (value === "") continue;
      addService({code: value, name: value, count: 1});
    }
  }
  const services = [...usage.values()]
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue ||
      a.name.localeCompare(b.name))
    .slice(0, 20);
  const typeRows = Object.entries(byType).map(([key, count]) => ({
    key,
    name: key,
    count,
    kind: "TYPE" as const,
  }));
  const serviceRows = services.map((row) => ({
    key: row.key,
    name: row.name,
    count: row.count,
    kind: "SERVICE" as const,
  }));
  const topService = [...typeRows, ...serviceRows]
    .sort((a, b) => b.count - a.count || (a.kind === b.kind ? 0 : a.kind === "SERVICE" ? -1 : 1))
    .at(0) ?? null;
  return {
    total: tickets.length + bookings.length,
    byType,
    byCategory,
    services,
    topService,
  };
};

type BookingSummary = {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  declined: number;
  noShow: number;
  byStatus: Record<string, number>;
  byService: Array<{key: string; name: string; count: number}>;
};

const collectBookings = (bookings: Row[]): BookingSummary => {
  const byStatus: Record<string, number> = {};
  const services = new Map<string, {key: string; name: string; count: number}>();
  let active = 0;
  let completed = 0;
  let cancelled = 0;
  let declined = 0;
  let noShow = 0;
  for (const booking of bookings) {
    const status = str(booking.status) || "UNKNOWN";
    bump(byStatus, status);
    if (BOOKING_OPEN_STATUSES.includes(status)) active += 1;
    if (status === BOOKING_STATUS.COMPLETED) completed += 1;
    if (status === BOOKING_STATUS.CANCELLED) cancelled += 1;
    if (status === BOOKING_STATUS.DECLINED) declined += 1;
    if (status === BOOKING_STATUS.NO_SHOW) noShow += 1;
    const snapshot = Array.isArray(booking.serviceSnapshot) ?
      booking.serviceSnapshot as Row[] :
      [];
    if (snapshot.length > 0) {
      for (const item of snapshot) {
        const key = (str(item.code) || str(item.name)).toLowerCase();
        if (key === "") continue;
        const row = services.get(key) ?? {
          key,
          name: str(item.name) || str(item.code),
          count: 0,
        };
        row.count += 1;
        services.set(key, row);
      }
      continue;
    }
    const codes = Array.isArray(booking.serviceCodes) ?
      booking.serviceCodes as unknown[] :
      [];
    for (const code of codes) {
      const value = str(code);
      if (value === "") continue;
      const key = value.toLowerCase();
      const row = services.get(key) ?? {key, name: value, count: 0};
      row.count += 1;
      services.set(key, row);
    }
  }
  return {
    total: bookings.length,
    active,
    completed,
    cancelled,
    declined,
    noShow,
    byStatus,
    byService: [...services.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 20),
  };
};

const isCompletedTicket = (ticket: Row): boolean => {
  const status = str(ticket.status);
  return status === STATUS_DISPATCH.RESOLVED ||
    status === STATUS_DISPATCH.RESOLVED_UNFIXABLE;
};

export {collectServiceMix, collectBookings, isCompletedTicket};
export type {ServiceMix, ServiceUsage, TopService, BookingSummary};
